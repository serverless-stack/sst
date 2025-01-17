package project

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/pulumi/pulumi/sdk/v3/go/auto/events"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/flag"
	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/js"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/project/provider"
	"github.com/sst/sst/v3/pkg/telemetry"
	"github.com/sst/sst/v3/pkg/types"
	"github.com/zeebo/xxh3"
	"golang.org/x/sync/errgroup"
)

func (p *Project) Run(ctx context.Context, input *StackInput) error {
	if flag.SST_EXPERIMENTAL_RUN {
		slog.Info("using next run system")
		return p.RunNext(ctx, input)
	}
	return p.RunOld(ctx, input)
}

func (p *Project) RunNext(ctx context.Context, input *StackInput) error {
	slog.Info("running stack command", "cmd", input.Command)

	if p.app.Protect && input.Command == "remove" {
		return ErrProtectedStage
	}

	bus.Publish(&StackCommandEvent{
		App:     p.app.Name,
		Stage:   p.app.Stage,
		Config:  p.PathConfig(),
		Command: input.Command,
		Version: p.Version(),
	})

	updateID := id.Descending()
	if input.Command != "diff" {
		err := p.Lock(updateID, input.Command)
		if err != nil {
			if err == provider.ErrLockExists {
				bus.Publish(&ConcurrentUpdateEvent{})
			}
			return err
		}
		defer p.Unlock()
	}

	workdir, err := p.NewWorkdir()
	if err != nil {
		return err
	}
	defer workdir.Cleanup()

	statePath, err := workdir.Pull()
	if err != nil {
		if errors.Is(err, provider.ErrStateNotFound) {
			if input.Command != "deploy" {
				return ErrStageNotFound
			}
		} else {
			return err
		}
	}

	passphrase, err := provider.Passphrase(p.home, p.app.Name, p.app.Stage)
	if err != nil {
		return err
	}

	completed, err := getCompletedEvent(ctx, passphrase, workdir)
	if err != nil {
		bus.Publish(&BuildFailedEvent{
			Error: err.Error(),
		})
		slog.Info("state file might be corrupted", "err", err)
		return err
	}
	completed.Finished = true
	completed.Old = true
	bus.Publish(completed)
	slog.Info("got previous deployment")

	cli := map[string]interface{}{
		"command": input.Command,
		"dev":     input.Dev,
		"paths": map[string]string{
			"home":     global.ConfigDir(),
			"root":     p.PathRoot(),
			"work":     p.PathWorkingDir(),
			"platform": p.PathPlatformDir(),
		},
		"state": map[string]interface{}{
			"version": completed.Versions,
		},
	}
	cliBytes, err := json.Marshal(cli)
	if err != nil {
		return err
	}
	appBytes, err := json.Marshal(p.app)
	if err != nil {
		return err
	}

	providerShim := []string{}
	for _, entry := range p.lock {
		providerShim = append(providerShim, fmt.Sprintf("import * as %s from \"%s\";", entry.Alias, entry.Package))
	}
	providerShim = append(providerShim, fmt.Sprintf("import * as sst from \"%s\";", path.Join(p.PathPlatformDir(), "src/components")))

	outfile := filepath.Join(p.PathPlatformDir(), fmt.Sprintf("sst.config.%v.mjs", time.Now().UnixMilli()))
	buildResult, err := js.Build(js.EvalOptions{
		Dir:     p.PathRoot(),
		Outfile: outfile,
		Define: map[string]string{
			"$app": string(appBytes),
			"$cli": string(cliBytes),
			"$dev": fmt.Sprintf("%v", input.Dev),
		},
		Inject:  []string{filepath.Join(p.PathWorkingDir(), "platform/src/shim/run.js")},
		Globals: strings.Join(providerShim, "\n"),
		Code: fmt.Sprintf(`
      import { run } from "%v";
      import mod from "%v/sst.config.ts";
      const result = await run(mod.run);
      export default result;
    `,
			path.Join(p.PathWorkingDir(), "platform/src/auto/run.ts"),
			p.PathRoot(),
		),
	})
	if err != nil {
		bus.Publish(&BuildFailedEvent{
			Error: err.Error(),
		})
		return err
	}
	if !flag.SST_NO_CLEANUP {
		defer js.Cleanup(buildResult)
	}

	// disable for now until we hash env too
	if input.SkipHash != "" && buildResult.OutputFiles[0].Hash == input.SkipHash && false {
		bus.Publish(&SkipEvent{})
		return nil
	}

	var meta = map[string]interface{}{}
	err = json.Unmarshal([]byte(buildResult.Metafile), &meta)
	if err != nil {
		return err
	}
	files := []string{}
	for key := range meta["inputs"].(map[string]interface{}) {
		absPath, err := filepath.Abs(key)
		if err != nil {
			continue
		}
		files = append(files, absPath)
	}
	bus.Publish(&BuildSuccessEvent{
		Files: files,
		Hash:  buildResult.OutputFiles[0].Hash,
	})
	slog.Info("tracked files")

	secrets := map[string]string{}
	fallback := map[string]string{}

	wg := errgroup.Group{}

	wg.Go(func() error {
		secrets, err = provider.GetSecrets(p.home, p.app.Name, p.app.Stage)
		if err != nil {
			return ErrPassphraseInvalid
		}
		return nil
	})

	wg.Go(func() error {
		fallback, err = provider.GetSecrets(p.home, p.app.Name, "")
		if err != nil {
			return ErrPassphraseInvalid
		}
		return nil
	})

	if err := wg.Wait(); err != nil {
		return err
	}

	env := os.Environ()
	for key, value := range p.Env() {
		env = append(env, fmt.Sprintf("%v=%v", key, value))
	}
	for key, value := range fallback {
		env = append(env, fmt.Sprintf("SST_SECRET_%v=%v", key, value))
	}
	for key, value := range secrets {
		env = append(env, fmt.Sprintf("SST_SECRET_%v=%v", key, value))
	}
	env = append(env,
		"PULUMI_CONFIG_PASSPHRASE="+passphrase,
		"PULUMI_SKIP_UPDATE_CHECK=true",
		"PULUMI_BACKEND_URL=file://"+workdir.Backend(),
		"PULUMI_DEBUG_COMMANDS=true",
		"PULUMI_DISABLE_AUTOMATIC_PLUGIN_ACQUISITION=true",
		"NODE_OPTIONS=--enable-source-maps --no-deprecation",
		"PULUMI_HOME="+global.ConfigDir(),
	)
	if input.ServerPort != 0 {
		env = append(env, "SST_SERVER=http://localhost:"+fmt.Sprint(input.ServerPort))
	}
	pulumiPath := flag.SST_PULUMI_PATH
	if pulumiPath == "" {
		pulumiPath = filepath.Join(global.BinPath(), "..")
	}

	os.WriteFile(
		filepath.Join(workdir.path, "Pulumi.yaml"),
		[]byte("name: "+p.app.Name+"\nruntime: nodejs\nmain: "+outfile+"\n"),
		0644,
	)
	eventLogPath := filepath.Join(workdir.path, "event.log")
	args := []string{
		"--stack", fmt.Sprintf("organization/%v/%v", p.app.Name, p.app.Stage),
		"--non-interactive",
		"--event-log", eventLogPath,
		"-f",
	}

	if input.Command == "deploy" || input.Command == "diff" {
		for provider, opts := range p.app.Providers {
			for key, value := range opts.(map[string]interface{}) {
				switch v := value.(type) {
				case map[string]interface{}:
					bytes, err := json.Marshal(v)
					if err != nil {
						return err
					}
					args = append(args, "--config", fmt.Sprintf("%v:%v=%v", provider, key, string(bytes)))
				case string:
					args = append(args, "--config", fmt.Sprintf("%v:%v=%v", provider, key, v))
				case []string:
					for i, val := range v {
						args = append(args, "--config", fmt.Sprintf("%v:%v[%d]=%v", provider, key, i, val))
					}
				}
			}
		}
	}

	switch input.Command {
	case "diff":
		args = append([]string{"diff"}, args...)
	case "refresh":
		args = append([]string{"refresh"}, args...)
	case "deploy":
		args = append([]string{"up"}, args...)
	case "remove":
		args = append([]string{"destroy"}, args...)
	}
	cmd := process.Command(filepath.Join(pulumiPath, "bin/pulumi"), args...)
	cmd.Env = env
	cmd.Stdout, _ = os.Create(p.PathLog("pulumi"))
	cmd.Stderr, _ = os.Create(p.PathLog("pulumi.err"))
	cmd.Dir = workdir.Backend()
	slog.Info("starting pulumi", "args", cmd.Args)

	eventlog, err := os.Create(p.PathLog("event"))
	if err != nil {
		return err
	}
	defer eventlog.Close()

	errors := []Error{}
	finished := false
	importDiffs := map[string][]ImportDiff{}
	partial := make(chan int, 1000)
	partialDone := make(chan error)
	go func() {
		last := uint64(0)
		for {
			select {
			case cmd := <-partial:
				data, err := os.ReadFile(statePath)
				if err == nil {
					next := xxh3.Hash(data)
					if next != last && next != 0 && input.Command != "diff" {
						err := provider.PushPartialState(p.Backend(), updateID, p.App().Name, p.App().Stage, data)
						if err != nil && cmd == 0 {
							partialDone <- err
							return
						}
					}
					last = next
					if cmd == 0 {
						partialDone <- provider.PushSnapshot(p.Backend(), updateID, p.App().Name, p.App().Stage, data)
						return
					}
				}
			case <-time.After(time.Second * 5):
				partial <- 1
				continue
			}
		}
	}()

	started := time.Now().Format(time.RFC3339)
	err = cmd.Start()
	if err != nil {
		return err
	}
	exited := make(chan error)
	go func() {
		exited <- cmd.Wait()
	}()

	go func() {
		<-ctx.Done()
		// if cmd.Process != nil {
		// 	cmd.Process.Signal(syscall.SIGINT)
		// }
	}()

	eventLog, err := os.OpenFile(eventLogPath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	reader := bufio.NewReader(eventLog)
loop:
	for {
		bytes, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				select {
				case <-exited:
					break loop
				default:
					time.Sleep(time.Millisecond * 100)
					continue
				}
			}
			return err
		}
		var event events.EngineEvent
		err = json.Unmarshal(bytes, &event)
		if err != nil {
			break
		}
		if event.DiagnosticEvent != nil && event.DiagnosticEvent.Severity == "error" {
			if strings.HasPrefix(event.DiagnosticEvent.Message, "update failed") {
				break
			}
			if strings.Contains(event.DiagnosticEvent.Message, "failed to register new resource") {
				break
			}

			// check if the error is a common error
			help := []string{}
			for _, commonError := range CommonErrors {
				if strings.Contains(event.DiagnosticEvent.Message, commonError.Message) {
					help = append(help, commonError.Short...)
				}
			}

			exists := false
			if event.DiagnosticEvent.URN != "" {
				for _, item := range errors {
					if item.URN == event.DiagnosticEvent.URN {
						exists = true
						break
					}
				}
			}
			if !exists {
				errors = append(errors, Error{
					Message: strings.TrimSpace(event.DiagnosticEvent.Message),
					URN:     event.DiagnosticEvent.URN,
					Help:    help,
				})
				telemetry.Track("cli.resource.error", map[string]interface{}{
					"error": event.DiagnosticEvent.Message,
					"urn":   event.DiagnosticEvent.URN,
				})
			}
		}

		if event.ResOpFailedEvent != nil {
			if event.ResOpFailedEvent.Metadata.Op == apitype.OpImport {
				for _, name := range event.ResOpFailedEvent.Metadata.Diffs {
					old := event.ResOpFailedEvent.Metadata.Old.Inputs[name]
					next := event.ResOpFailedEvent.Metadata.New.Inputs[name]
					diffs, ok := importDiffs[event.ResOpFailedEvent.Metadata.URN]
					if !ok {
						diffs = []ImportDiff{}
					}
					importDiffs[event.ResOpFailedEvent.Metadata.URN] = append(diffs, ImportDiff{
						URN:   event.ResOpFailedEvent.Metadata.URN,
						Input: name,
						Old:   old,
						New:   next,
					})
				}
			}
		}

		if event.ResOutputsEvent != nil || event.CancelEvent != nil || event.SummaryEvent != nil {
			partial <- 1
		}

		for _, field := range getNotNilFields(event) {
			bus.Publish(field)
		}

		if event.SummaryEvent != nil {
			finished = true
		}

		bytes, err = json.Marshal(event)
		if err != nil {
			break
		}
		eventlog.Write(bytes)
		eventlog.WriteString("\n")
	}

	partial <- 0
	err = <-partialDone
	if err != nil {
		return err
	}

	slog.Info("parsing state")
	complete, err := getCompletedEvent(context.Background(), passphrase, workdir)
	if err != nil {
		return err
	}
	complete.Finished = finished
	complete.Errors = errors
	complete.ImportDiffs = importDiffs
	types.Generate(p.PathConfig(), complete.Links)
	defer bus.Publish(complete)
	if input.Command == "diff" {
		return err
	}

	outputsFilePath := filepath.Join(p.PathWorkingDir(), "outputs.json")
	outputsFile, _ := os.Create(outputsFilePath)
	defer outputsFile.Close()
	json.NewEncoder(outputsFile).Encode(complete.Outputs)

	if input.Command != "diff " {
		var update provider.Update
		update.ID = updateID
		update.Command = input.Command
		update.Version = p.Version()
		update.TimeStarted = started
		update.TimeCompleted = time.Now().Format(time.RFC3339)
		for _, err := range errors {
			update.Errors = append(update.Errors, provider.SummaryError{
				URN:     err.URN,
				Message: err.Message,
			})
		}
		err = provider.PutUpdate(p.home, p.app.Name, p.app.Stage, update)
		if err != nil {
			return err
		}
	}

	slog.Info("done running stack command")
	if cmd.ProcessState.ExitCode() > 0 {
		return ErrStackRunFailed
	}
	return nil
}
