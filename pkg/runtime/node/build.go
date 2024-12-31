package node

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/evanw/esbuild/pkg/api"
	esbuild "github.com/evanw/esbuild/pkg/api"
	"github.com/sst/sst/v3/internal/fs"
	"github.com/sst/sst/v3/pkg/js"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/runtime"
)

var forceExternal = []string{
	"sharp", "pg-native",
}

func (r *Runtime) Build(ctx context.Context, input *runtime.BuildInput) (*runtime.BuildOutput, error) {
	r.concurrency.Acquire(ctx, 1)
	defer r.concurrency.Release(1)
	var properties NodeProperties
	json.Unmarshal(input.Properties, &properties)

	file, ok := r.getFile(input)
	if !ok {
		return nil, fmt.Errorf("Handler not found: %v", input.Handler)
	}

	isESM := true
	extension := ".mjs"

	if properties.Format == "cjs" {
		isESM = false
		extension = ".cjs"
	}

	handler := "bundle" + filepath.Ext(input.Handler)
	target := filepath.Join(input.Out(), "bundle"+extension)
	slog.Info("loader info", "loader", properties.Loader)

	loader := map[string]esbuild.Loader{}
	for key, value := range properties.Loader {
		mapped, ok := loaderMap[value]
		if !ok {
			continue
		}
		loader[key] = mapped
	}

	plugins := []esbuild.Plugin{
		{
			Name: "sst-version-check",
			Setup: func(build esbuild.PluginBuild) {
				skipResolve := struct{}{}
				build.OnResolve(api.OnResolveOptions{Filter: `^sst$`}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
					// avoid recursion
					if args.PluginData == skipResolve {
						return api.OnResolveResult{}, nil
					}
					pkg := build.Resolve("sst", esbuild.ResolveOptions{
						ResolveDir: args.ResolveDir,
						Importer:   args.Importer,
						Kind:       args.Kind,
						With:       args.With,
						PluginName: "sst-version-check",
						PluginData: skipResolve,
						Namespace:  args.Namespace,
					})
					if pkg.Path != "" {
						path, err := fs.FindUp(pkg.Path, "package.json")
						if err != nil {
							return api.OnResolveResult{}, err
						}
						var pkgjson js.PackageJson
						data, err := os.Open(path)
						if err != nil {
							return api.OnResolveResult{}, err
						}
						err = json.NewDecoder(data).Decode(&pkgjson)
						if err != nil {
							return api.OnResolveResult{}, err
						}
						if r.version != "dev" && pkgjson.Version != r.version {
							return api.OnResolveResult{}, fmt.Errorf("The sst package your application is importing (%v) does not match the sst cli version (%v). Make sure the version of sst in package.json is correct across your entire repo.", pkgjson.Version, r.version)
						}
					}
					return api.OnResolveResult{Path: pkg.Path}, nil
				})
			},
		},
	}
	if properties.Plugins != "" {
		plugins = append(plugins, plugin(properties.Plugins))
	}
	external := append(forceExternal, func() []string {
		result := make([]string, 0, len(properties.Install))
		for key := range properties.Install {
			result = append(result, key)
		}
		return result
	}()...)
	external = append(external, properties.ESBuild.External...)
	options := esbuild.BuildOptions{
		EntryPoints: []string{file},
		Platform:    esbuild.PlatformNode,
		External:    external,
		Loader:      loader,
		KeepNames:   true,
		Bundle:      true,
		Splitting:   properties.Splitting,
		Metafile:    true,
		Outfile:     target,
		Plugins:     plugins,
		Sourcemap:   esbuild.SourceMapLinked,
		Write:       true,
		Format:      esbuild.FormatESModule,
		Target:      esbuild.ESNext,
		MainFields:  []string{"module", "main"},
		Banner: map[string]string{
			"js": strings.Join([]string{
				`import { createRequire as topLevelCreateRequire } from 'module';`,
				`const require = topLevelCreateRequire(import.meta.url);`,
				`import { fileURLToPath as topLevelFileUrlToPath, URL as topLevelURL } from "url"`,
				`const __filename = topLevelFileUrlToPath(import.meta.url)`,
				`const __dirname = topLevelFileUrlToPath(new topLevelURL(".", import.meta.url))`,
				properties.Banner,
			}, "\n"),
		},
		NodePaths: properties.ESBuild.NodePaths,
	}

	if !isESM {
		options.Format = esbuild.FormatCommonJS
		options.Target = esbuild.ESNext
		options.Banner["js"] = properties.Banner
		options.MainFields = []string{"main"}
	}

	if properties.ESBuild.Target != 0 {
		options.Target = properties.ESBuild.Target
	}

	if properties.Splitting {
		options.Outdir = filepath.Dir(target)
		options.OutExtension = map[string]string{
			".js": ".mjs",
		}
		options.Outfile = ""
	}

	if !input.Dev {
		if properties.Minify {
			options.MinifyWhitespace = properties.Minify
			options.MinifySyntax = properties.Minify
			options.MinifyIdentifiers = properties.Minify
		}
		if properties.SourceMap != nil && *properties.SourceMap == false {
			options.Sourcemap = esbuild.SourceMapLinked
		}
	}

	if properties.ESBuild.Target != 0 {
		options.Target = properties.ESBuild.Target
	}

	var result esbuild.BuildResult

	if !input.Dev {
		context, _ := esbuild.Context(options)
		result = context.Rebuild()
		context.Dispose()
	}

	if input.Dev {
		match, ok := r.contexts.Load(input.FunctionID)
		if !ok {
			match, _ = esbuild.Context(options)
			r.contexts.Store(input.FunctionID, match)
		}
		result = match.(esbuild.BuildContext).Rebuild()
		r.results.Store(input.FunctionID, result)
	}

	errors := []string{}
	for _, error := range result.Errors {
		text := error.Text
		if error.Location != nil {
			text = text + " " + error.Location.File + ":" + fmt.Sprint(error.Location.Line) + ":" + fmt.Sprint(error.Location.Column)
		}
		errors = append(errors, text)
	}
	for _, error := range result.Errors {
		slog.Error("esbuild error", "error", error)
	}
	for _, warning := range result.Warnings {
		slog.Error("esbuild error", "error", warning)
	}

	if input.Dev {
		nodeModules, err := fs.FindUp(file, "node_modules")
		if err == nil {
			os.Symlink(nodeModules, filepath.Join(input.Out(), "node_modules"))
		}
	}

	sourcemaps := []string{}
	if !input.Dev {
		if properties.SourceMap == nil {
			for _, file := range result.OutputFiles {
				if strings.HasSuffix(file.Path, ".map") {
					sourcemaps = append(sourcemaps, file.Path)
				}
			}
		}
		var metafile js.Metafile
		json.Unmarshal([]byte(result.Metafile), &metafile)

		installPackages := func() []string {
			packages := make([]string, 0, len(properties.Install))
			for pkg := range properties.Install {
				packages = append(packages, pkg)
			}
			return packages
		}()
		for _, pkg := range forceExternal {
			if slices.Contains(properties.ESBuild.External, pkg) {
				continue
			}
			for _, input := range metafile.Inputs {
				for _, imp := range input.Imports {
					if imp.Kind == "external" && imp.Path == pkg {
						installPackages = append(installPackages, pkg)
					}
				}
			}
		}

		if len(installPackages) > 0 {
			src, err := fs.FindUp(filepath.Dir(target), "package.json")
			if err != nil {
				return nil, err
			}
			file, err := os.Open(src)
			if err != nil {
				return nil, err
			}
			defer file.Close()
			var parsed js.PackageJson
			err = json.NewDecoder(file).Decode(&parsed)
			if err != nil {
				return nil, err
			}
			dependencies := map[string]string{}
			for _, pkg := range installPackages {
				if val, ok := properties.Install[pkg]; ok {
					dependencies[pkg] = val
				} else {
					dependencies[pkg] = "*"
				}
				if parsed.Dependencies[pkg] != "" {
					dependencies[pkg] = parsed.Dependencies[pkg]
				}
			}
			outPkg := filepath.Join(input.Out(), "package.json")
			outFile, err := os.Create(outPkg)
			if err != nil {
				return nil, err
			}
			json.NewEncoder(outFile).Encode(map[string]interface{}{
				"dependencies": dependencies,
			})
			outFile.Close()

			cmd := []string{
				"install",
				"--force",
				"--platform=linux",
				"--os=linux",
				"--arch=x64",
				"--cpu=x64",
			}
			if properties.Architecture == "arm64" {
				cmd[4] = "--arch=arm64"
				cmd[5] = "--cpu=arm64"
			}
			if slices.Contains(installPackages, "sharp") {
				cmd = append(cmd, "--libc=glibc")
			}
			proc := process.Command("npm", cmd...)
			proc.Dir = input.Out()
			err = proc.Run()
			if err != nil {
				return nil, err
			}
		}
	}

	return &runtime.BuildOutput{
		Handler:    handler,
		Errors:     errors,
		Sourcemaps: sourcemaps,
	}, nil
}
