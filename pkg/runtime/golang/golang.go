package golang

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/sst/sst/v3/internal/fs"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/runtime"
)

type Runtime struct {
	mut         sync.Mutex
	directories map[string]string
}

type Worker struct {
	stdout io.ReadCloser
	stderr io.ReadCloser
	cmd    *exec.Cmd
}

func (w *Worker) Stop() {
	process.Kill(w.cmd.Process)
}

func (w *Worker) Logs() io.ReadCloser {
	reader, writer := io.Pipe()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(writer, w.stdout)
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(writer, w.stderr)
	}()

	go func() {
		wg.Wait()
		defer writer.Close()
	}()

	return reader
}

func New() *Runtime {
	return &Runtime{
		directories: map[string]string{},
	}
}

func (r *Runtime) Match(runtime string) bool {
	return runtime == "go"
}

type Properties struct {
	Architecture string `json:"architecture"`
}

func (r *Runtime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	r.mut.Lock()
	defer r.mut.Unlock()
	var properties Properties
	json.Unmarshal(input.Properties, &properties)

	gomod, err := fs.FindUp(input.Handler, "go.mod")
	if err != nil {
		return nil, err
	}
	// root of go project
	root := filepath.Dir(gomod)
	src, _ := filepath.Rel(root, input.Handler)
	out := filepath.Join(input.Out(), "bootstrap")
	args := []string{"build"}
	env := os.Environ()
	if !input.Dev {
		args = append(args, "-ldflags", "-s -w")
		env = append(env, "CGO_ENABLED=0")
		env = append(env, "GOOS=linux")
		env = append(env, "GOARCH=amd64")
		if properties.Architecture == "arm64" {
			env = append(env, "GOARCH=arm64")
		}
	}
	args = append(args, "-o", out, src)
	cmd := process.Command("go", args...)
	cmd.Dir = root
	cmd.Env = env
	slog.Info("running go build", "cmd", cmd.Args)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return &runtime.BuildOutput{
			Errors: []string{string(output)},
		}, nil
	}
	r.directories[input.FunctionID], _ = filepath.Abs(root)
	return &runtime.BuildOutput{
		Handler:    "bootstrap",
		Sourcemaps: []string{},
		Errors:     []string{},
		Out:        root,
	}, nil
}

func (r *Runtime) Run(ctx context.Context, input *runtime.RunInput) (runtime.Worker, error) {
	cmd := process.CommandContext(
		ctx,
		filepath.Join(input.Build.Out, input.Build.Handler),
	)
	slog.Info("running go run", "server", input.Server)
	cmd.Env = input.Env
	cmd.Env = append(cmd.Env, "AWS_LAMBDA_RUNTIME_API="+input.Server)
	cmd.Dir = input.Build.Out
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	cmd.Start()
	return &Worker{
		stdout,
		stderr,
		cmd,
	}, nil
}

func (r *Runtime) ShouldRebuild(functionID string, file string) bool {
	if !strings.HasSuffix(file, ".go") {
		return false
	}
	match, ok := r.directories[functionID]
	if !ok {
		return false
	}
	slog.Info("checking if file needs to be rebuilt", "file", file, "match", match)
	rel, err := filepath.Rel(match, file)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}
