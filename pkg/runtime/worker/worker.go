package worker

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/evanw/esbuild/pkg/api"
	esbuild "github.com/evanw/esbuild/pkg/api"
	"github.com/sst/sst/v3/pkg/project/path"
	"github.com/sst/sst/v3/pkg/runtime"
	"github.com/sst/sst/v3/pkg/runtime/node"
)

type Runtime struct {
	contexts map[string]esbuild.BuildContext
	results  map[string]esbuild.BuildResult
	lock     sync.RWMutex
	unenv    *unenv
}

type Properties struct {
	AccountID  string              `json:"accountID"`
	ScriptName string              `json:"scriptName"`
	Build      node.NodeProperties `json:"build"`
}

type unenv struct {
	Alias    map[string]string `json:"alias"`
	Polyfill []string          `json:"polyfill"`
}

//go:embed unenv.json
var embedded embed.FS

func New() *Runtime {
	data, _ := embedded.ReadFile("unenv.json")
	var unenv unenv
	json.Unmarshal(data, &unenv)
	return &Runtime{
		contexts: map[string]esbuild.BuildContext{},
		results:  map[string]esbuild.BuildResult{},
		lock:     sync.RWMutex{},
		unenv:    &unenv,
	}
}

func (w *Runtime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	var properties Properties
	json.Unmarshal(input.Properties, &properties)
	build := properties.Build

	abs, err := filepath.Abs(input.Handler)
	if err != nil {
		return nil, err
	}
	target := filepath.Join(input.Out(), input.Handler)

	slog.Info("loader info", "loader", build.Loader)

	loader := map[string]esbuild.Loader{}
	loaderMap := map[string]api.Loader{
		"js":      api.LoaderJS,
		"jsx":     api.LoaderJSX,
		"ts":      api.LoaderTS,
		"tsx":     api.LoaderTSX,
		"css":     api.LoaderCSS,
		"json":    api.LoaderJSON,
		"text":    api.LoaderText,
		"base64":  api.LoaderBase64,
		"file":    api.LoaderFile,
		"dataurl": api.LoaderDataURL,
		"binary":  api.LoaderBinary,
	}

	for key, value := range build.Loader {
		mapped, ok := loaderMap[value]
		if !ok {
			continue
		}
		loader[key] = mapped
	}

	options := esbuild.BuildOptions{
		Platform: esbuild.PlatformNode,
		Stdin: &esbuild.StdinOptions{
			Contents: fmt.Sprintf(`
      import handler from "%s"
      import { fromCloudflareEnv, wrapCloudflareHandler } from "sst"
      export default wrapCloudflareHandler(handler)
      `, abs),
			ResolveDir: filepath.Dir(abs),
			Loader:     esbuild.LoaderTS,
		},
		NodePaths: []string{
			filepath.Join(path.ResolvePlatformDir(input.CfgPath), "node_modules"),
		},
		Alias:             w.unenv.Alias,
		Inject:            w.unenv.Polyfill,
		External:          []string{"node:*", "cloudflare:workers"},
		Conditions:        []string{"workerd", "worker", "browser"},
		Sourcemap:         esbuild.SourceMapNone,
		Loader:            loader,
		KeepNames:         true,
		Bundle:            true,
		Define:            build.ESBuild.Define,
		Splitting:         build.Splitting,
		Metafile:          true,
		Write:             true,
		Outfile:           target,
		MinifyWhitespace:  build.Minify,
		MinifySyntax:      build.Minify,
		MinifyIdentifiers: build.Minify,
		Target:            esbuild.ESNext,
		Format:            esbuild.FormatESModule,
		MainFields:        []string{"module", "main"},
		Banner: map[string]string{
			"js": func() string {
				defaultBanner := strings.Join([]string{
					`import { createRequire as topLevelCreateRequire } from 'module';`,
					`const require = topLevelCreateRequire("/");`,
				}, "\n")
				
				if banner, ok := build.ESBuild.Banner["js"]; ok {
					return banner + "\n" + defaultBanner
				}
				return defaultBanner
			}(),
		},
	}

	w.lock.RLock()
	buildContext, ok := w.contexts[input.FunctionID]
	w.lock.RUnlock()
	if !ok {
		buildContext, _ = esbuild.Context(options)
		w.lock.Lock()
		w.contexts[input.FunctionID] = buildContext
		w.lock.Unlock()
	}

	result := buildContext.Rebuild()
	if len(result.Errors) == 0 {
		w.lock.Lock()
		w.results[input.FunctionID] = result
		w.lock.Unlock()
	}
	errors := []string{}
	for _, error := range result.Errors {
		errors = append(errors, error.Text)
	}

	for _, error := range result.Errors {
		slog.Error("esbuild error", "error", error)
	}
	for _, warning := range result.Warnings {
		slog.Error("esbuild error", "error", warning)
	}

	return &runtime.BuildOutput{
		Handler: input.Handler,
		Errors:  errors,
	}, nil
}

func (w *Runtime) Match(runtime string) bool {
	return runtime == "worker"
}

func (w *Runtime) getFile(input *runtime.BuildInput) (string, bool) {
	dir := filepath.Dir(input.Handler)
	base := strings.Split(filepath.Base(input.Handler), ".")[0]
	for _, ext := range node.NODE_EXTENSIONS {
		file := filepath.Join(path.ResolveRootDir(input.CfgPath), dir, base+ext)
		if _, err := os.Stat(file); err == nil {
			return file, true
		}
	}
	return "", false
}

func (r *Runtime) ShouldRebuild(functionID string, file string) bool {
	r.lock.RLock()
	result, ok := r.results[functionID]
	r.lock.RUnlock()
	if !ok {
		return false
	}

	var meta = map[string]interface{}{}
	err := json.Unmarshal([]byte(result.Metafile), &meta)
	if err != nil {
		return false
	}
	for key := range meta["inputs"].(map[string]interface{}) {
		absPath, err := filepath.Abs(key)
		if err != nil {
			continue
		}
		if absPath == file {
			return true
		}
	}

	return false
}

func (r *Runtime) Run(ctx context.Context, input *runtime.RunInput) (runtime.Worker, error) {
	return nil, fmt.Errorf("not implemented")
}

var NODE_BUILTINS = map[string]bool{
	"assert":              true,
	"async_hooks":         true,
	"buffer":              true,
	"child_process":       true,
	"cluster":             true,
	"console":             true,
	"constants":           true,
	"crypto":              true,
	"dgram":               true,
	"diagnostics_channel": true,
	"dns":                 true,
	"domain":              true,
	"events":              true,
	"fs":                  true,
	"http":                true,
	"http2":               true,
	"https":               true,
	"inspector":           true,
	"module":              true,
	"net":                 true,
	"os":                  true,
	"path":                true,
	"perf_hooks":          true,
	"process":             true,
	"punycode":            true,
	"querystring":         true,
	"readline":            true,
	"repl":                true,
	"stream":              true,
	"string_decoder":      true,
	"sys":                 true,
	"timers":              true,
	"tls":                 true,
	"trace_events":        true,
	"tty":                 true,
	"url":                 true,
	"util":                true,
	"v8":                  true,
	"vm":                  true,
	"wasi":                true,
	"worker_threads":      true,
	"zlib":                true,
}
