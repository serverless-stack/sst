package project

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/pulumi/pulumi/sdk/v3/go/auto"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/debug"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/events"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/optdestroy"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/optpreview"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/optrefresh"
	"github.com/pulumi/pulumi/sdk/v3/go/auto/optup"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
	"github.com/pulumi/pulumi/sdk/v3/go/common/workspace"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/flag"
	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/js"
	"github.com/sst/sst/v3/pkg/project/common"
	"github.com/sst/sst/v3/pkg/project/provider"
	"github.com/sst/sst/v3/pkg/telemetry"
	"github.com/sst/sst/v3/pkg/types"
	"github.com/zeebo/xxh3"
	"golang.org/x/sync/errgroup"
)

type BuildFailedEvent struct {
	Error string
}

type StackInput struct {
	Command    string
	Target     []string
	ServerPort int
	Dev        bool
	Verbose    bool
	Continue   bool
	SkipHash   string
}

type ConcurrentUpdateEvent struct{}

type BuildSuccessEvent struct {
	Files []string
	Hash  string
}

type SkipEvent struct {
}

type Dev struct {
	Name        string            `json:"name"`
	Command     string            `json:"command"`
	Directory   string            `json:"directory"`
	Autostart   bool              `json:"autostart"`
	Links       []string          `json:"links"`
	Title       string            `json:"title"`
	Environment map[string]string `json:"environment"`
	Aws         *struct {
		Role string `json:"role"`
	} `json:"aws"`
}
type Devs map[string]Dev

type Task struct {
	Name      string `json:"-"`
	Command   string `json:"command"`
	Directory string `json:"directory"`
}

type CompleteEvent struct {
	Links       common.Links
	Devs        Devs
	Tasks       map[string]Task
	Outputs     map[string]interface{}
	Hints       map[string]string
	Versions    map[string]int
	Errors      []Error
	Finished    bool
	Old         bool
	Resources   []apitype.ResourceV3
	ImportDiffs map[string][]ImportDiff
	Tunnels     map[string]Tunnel
}

type Tunnel struct {
	IP         string   `json:"ip"`
	Username   string   `json:"username"`
	PrivateKey string   `json:"privateKey"`
	Subnets    []string `json:"subnets"`
}

type ImportDiff struct {
	URN   string
	Input string
	Old   interface{}
	New   interface{}
}

type StackCommandEvent struct {
	App     string
	Stage   string
	Config  string
	Command string
	Version string
}

type Error struct {
	Message string   `json:"message"`
	URN     string   `json:"urn"`
	Help    []string `json:"help"`
}

type CommonError struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Short   []string `json:"short"`
	Long    []string `json:"long"`
}

var CommonErrors = []CommonError{
	{
		Code:    "TooManyCacheBehaviors",
		Message: "TooManyCacheBehaviors: Your request contains more CacheBehaviors than are allowed per distribution",
		Short: []string{
			"There are too many top-level files and directories inside your app's public asset directory. Move some of them inside subdirectories.",
			"Learn more about this https://sst.dev/docs/common-errors#toomanycachebehaviors",
		},
		Long: []string{
			"This error usually happens to `SvelteKit`, `SolidStart`, `Nuxt`, and `Analog` components.",
			"",
			"CloudFront distributions have a **limit of 25 cache behaviors** per distribution. Each top-level file or directory in your frontend app's asset directory creates a cache behavior.",
			"",
			"For example, in the case of SvelteKit, the static assets are in the `static/` directory. If you have a file and a directory in it, it'll create 2 cache behaviors.",
			"",
			"```bash frame=\"none\"",
			"static/",
			"├── icons/       # Cache behavior for /icons/*",
			"└── logo.png     # Cache behavior for /logo.png",
			"```",
			"So if you have many of these at the top-level, you'll hit the limit. You can request a limit increase through the AWS Support.",
			"",
			"Alternatively, you can move some of these into subdirectories. For example, moving them to an `images/` directory, will only create 1 cache behavior.",
			"",
			"```bash frame=\"none\"",
			"static/",
			"└── images/      # Cache behavior for /images/*",
			"    ├── icons/",
			"    └── logo.png",
			"```",
			"Learn more about these [CloudFront limits](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html#limits-web-distributions).",
		},
	},
}

var ErrStackRunFailed = fmt.Errorf("stack run had errors")
var ErrStageNotFound = fmt.Errorf("stage not found")
var ErrPassphraseInvalid = fmt.Errorf("passphrase invalid")
var ErrProtectedStage = fmt.Errorf("cannot remove protected stage")

func (p *Project) Run(ctx context.Context, input *StackInput) error {
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
	defer workdir.Cleanup()

	passphrase, err := provider.Passphrase(p.home, p.app.Name, p.app.Stage)
	if err != nil {
		return err
	}

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

	outfile := filepath.Join(p.PathPlatformDir(), fmt.Sprintf("sst.config.%v.mjs", time.Now().UnixMilli()))

	env := map[string]string{}
	for key, value := range p.Env() {
		env[key] = value
	}
	for _, value := range os.Environ() {
		pair := strings.SplitN(value, "=", 2)
		if len(pair) == 2 {
			env[pair[0]] = pair[1]
		}
	}
	for key, value := range fallback {
		env["SST_SECRET_"+key] = value
	}
	for key, value := range secrets {
		env["SST_SECRET_"+key] = value
	}
	env["PULUMI_CONFIG_PASSPHRASE"] = passphrase
	env["PULUMI_SKIP_UPDATE_CHECK"] = "true"
	// env["PULUMI_DISABLE_AUTOMATIC_PLUGIN_ACQUISITION"] = "true"
	env["NODE_OPTIONS"] = "--enable-source-maps --no-deprecation"
	// env["TMPDIR"] = p.PathLog("")
	if input.ServerPort != 0 {
		env["SST_SERVER"] = fmt.Sprintf("http://localhost:%v", input.ServerPort)
	}
	pulumiPath := flag.SST_PULUMI_PATH
	if pulumiPath == "" {
		pulumiPath = filepath.Join(global.BinPath(), "..")
	}
	pulumi, err := auto.NewPulumiCommand(&auto.PulumiCommandOptions{
		Root:             pulumiPath,
		SkipVersionCheck: true,
	})
	if err != nil {
		return err
	}
	ws, err := auto.NewLocalWorkspace(ctx,
		auto.Pulumi(pulumi),
		auto.WorkDir(workdir.Backend()),
		auto.PulumiHome(global.ConfigDir()),
		auto.Project(workspace.Project{
			Name:    tokens.PackageName(p.app.Name),
			Runtime: workspace.NewProjectRuntimeInfo("nodejs", nil),
			Backend: &workspace.ProjectBackend{
				URL: fmt.Sprintf("file://%v", workdir.Backend()),
			},
			Main: outfile,
		}),
		auto.EnvVars(
			env,
		),
	)
	if err != nil {
		return err
	}
	slog.Info("built workspace")

	stack, err := auto.UpsertStack(ctx,
		p.app.Stage,
		ws,
	)
	if err != nil {
		return err
	}
	slog.Info("built stack")

	completed, err := getCompletedEvent(ctx, stack)
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

	config := auto.ConfigMap{}
	for provider, args := range p.app.Providers {
		for key, value := range args.(map[string]interface{}) {
			switch v := value.(type) {
			case map[string]interface{}:
				bytes, err := json.Marshal(v)
				if err != nil {
					return err
				}
				config[fmt.Sprintf("%v:%v", provider, key)] = auto.ConfigValue{Value: string(bytes)}
			case string:
				config[fmt.Sprintf("%v:%v", provider, key)] = auto.ConfigValue{Value: v}
			case []string:
				for i, val := range v {
					config[fmt.Sprintf("%v:%v[%d]", provider, key, i)] = auto.ConfigValue{Value: val}
				}
			}
		}
	}
	err = stack.SetAllConfig(ctx, config)
	if err != nil {
		return err
	}
	slog.Info("built config")

	stream := make(chan events.EngineEvent)
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
				slog.Info("partial loop", "cmd", cmd)
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

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-stream:
				if !ok {
					return
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

				bytes, err := json.Marshal(event)
				if err != nil {
					return
				}
				eventlog.Write(bytes)
				eventlog.WriteString("\n")
			}
		}
	}()

	slog.Info("running stack command", "cmd", input.Command)

	pulumiLog, err := os.Create(p.PathLog("pulumi"))
	if err != nil {
		return err
	}
	defer pulumiLog.Close()

	logLevel := uint(3)
	debugLogging := debug.LoggingOptions{
		LogLevel: &logLevel,
	}
	if input.Verbose {
		slog.Info("enabling verbose logging")
		logLevel = uint(11)
		debugLogging = debug.LoggingOptions{
			LogLevel:      &logLevel,
			FlowToPlugins: true,
			Tracing:       "file://" + filepath.Join(p.PathWorkingDir(), "log", "trace.json"),
		}
	}

	started := time.Now().Format(time.RFC3339)
	var runError error
	switch input.Command {
	case "deploy":
		opts := []optup.Option{
			optup.DebugLogging(debugLogging),
			optup.Target(input.Target),
			optup.TargetDependents(),
			optup.ProgressStreams(pulumiLog),
			optup.EventStreams(stream),
		}
		if input.Continue {
			opts = append(opts, optup.ContinueOnError())
		}
		_, runError = stack.Up(ctx,
			opts...,
		)

	case "remove":
		_, runError = stack.Destroy(ctx,
			optdestroy.DebugLogging(debugLogging),
			optdestroy.ContinueOnError(),
			optdestroy.Target(input.Target),
			optdestroy.TargetDependents(),
			optdestroy.ProgressStreams(pulumiLog),
			optdestroy.EventStreams(stream),
			optdestroy.ContinueOnError(),
		)

	case "refresh":

		_, runError = stack.Refresh(ctx,
			optrefresh.DebugLogging(debugLogging),
			optrefresh.Target(input.Target),
			optrefresh.ProgressStreams(pulumiLog),
			optrefresh.EventStreams(stream),
		)
	case "diff":
		_, runError = stack.Preview(ctx,
			optpreview.DebugLogging(debugLogging),
			optpreview.Diff(),
			optpreview.Target(input.Target),
			optpreview.ProgressStreams(pulumiLog),
			optpreview.EventStreams(stream),
		)
	}

	slog.Info("waiting for partial state to finish")
	partial <- 0
	err = <-partialDone
	if err != nil {
		return err
	}

	slog.Info("parsing state")
	complete, err := getCompletedEvent(context.Background(), stack)
	if err != nil {
		return err
	}
	complete.Finished = finished
	complete.Errors = errors
	complete.ImportDiffs = importDiffs
	defer bus.Publish(complete)
	if input.Command == "diff" {
		return err
	}

	outputsFilePath := filepath.Join(p.PathWorkingDir(), "outputs.json")
	outputsFile, _ := os.Create(outputsFilePath)
	defer outputsFile.Close()
	json.NewEncoder(outputsFile).Encode(complete.Outputs)
	types.Generate(p.PathConfig(), complete.Links)

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
	if runError != nil {
		slog.Error("stack run failed", "error", runError)
		return ErrStackRunFailed
	}
	return nil
}

func (p *Project) Lock(updateID string, command string) error {
	return provider.Lock(p.home, updateID, p.Version(), command, p.app.Name, p.app.Stage)
}

func (s *Project) Unlock() error {
	return provider.Unlock(s.home, s.version, s.app.Name, s.app.Stage)
}

func (s *Project) ForceUnlock() error {
	return provider.ForceUnlock(s.home, s.version, s.app.Name, s.app.Stage)
}

func getNotNilFields(v interface{}) []interface{} {
	result := []interface{}{}
	val := reflect.ValueOf(v)
	if val.Kind() == reflect.Ptr {
		val = val.Elem()
	}
	if val.Kind() != reflect.Struct {
		result = append(result, v)
		return result
	}

	for i := 0; i < val.NumField(); i++ {
		field := val.Field(i)
		switch field.Kind() {
		case reflect.Struct:
			result = append(result, getNotNilFields(field.Interface())...)
			break
		case reflect.Ptr, reflect.Interface, reflect.Slice, reflect.Map, reflect.Chan, reflect.Func:
			if !field.IsNil() {
				result = append(result, field.Interface())
			}
			break
		}
	}

	return result
}
