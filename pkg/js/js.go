package js

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	esbuild "github.com/evanw/esbuild/pkg/api"
)

type EvalOptions struct {
	Dir     string
	Outfile string
	Code    string
	Env     []string
	Globals string
	Banner  string
	Inject  []string
	Define  map[string]string
}

type PackageJson struct {
	Version         string                 `json:"version"`
	Dependencies    map[string]string      `json:"dependencies"`
	DevDependencies map[string]string      `json:"devDependencies"`
	Other           map[string]interface{} `json:"-"`
}

type Metafile struct {
	Inputs map[string]struct {
		Bytes   int `json:"bytes"`
		Imports []struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		} `json:"imports"`
	} `json:"inputs"`
	Outputs map[string]struct {
		Bytes  int `json:"bytes"`
		Inputs map[string]struct {
			BytesInOutput int `json:"bytesInOutput"`
		} `json:"inputs"`
		Exports    []string `json:"exports"`
		Entrypoint string   `json:"entrypoint"`
	} `json:"outputs"`
}

func Build(input EvalOptions) (esbuild.BuildResult, error) {
	outfile := input.Outfile
	if outfile == "" {
		outfile = filepath.Join(input.Dir, ".sst", "platform", fmt.Sprintf("sst.config.%v.mjs", time.Now().UnixMilli()))
	}
	slog.Info("esbuild building", "out", outfile)
	result := esbuild.Build(esbuild.BuildOptions{
		Banner: map[string]string{
			"js": `
import { createRequire as topLevelCreateRequire } from 'module';
const require = topLevelCreateRequire(import.meta.url);
import { fileURLToPath as topLevelFileUrlToPath, URL as topLevelURL } from "url"
const __filename = topLevelFileUrlToPath(import.meta.url)
const __dirname = topLevelFileUrlToPath(new topLevelURL(".", import.meta.url))
` + input.Banner,
		},
		MainFields: []string{"module", "main"},
		Format:     esbuild.FormatESModule,
		Platform:   esbuild.PlatformNode,
		Sourcemap:  esbuild.SourceMapLinked,
		Stdin: &esbuild.StdinOptions{
			// Replace all backslashes with forward slashes to avoid issues with windows paths
			Contents:   strings.ReplaceAll(input.Code, "\\", "/"),
			ResolveDir: input.Dir,
			Sourcefile: "eval.ts",
			Loader:     esbuild.LoaderTS,
		},
		NodePaths: []string{
			filepath.Join(input.Dir, ".sst", "platform", "node_modules"),
		},
		Plugins: []esbuild.Plugin{
			{
				Name: "InjectGlobals",
				Setup: func(build esbuild.PluginBuild) {
					build.OnLoad(esbuild.OnLoadOptions{Filter: `\.(js|ts|jsx|tsx)$`},
						func(args esbuild.OnLoadArgs) (esbuild.OnLoadResult, error) {
							contents, err := os.ReadFile(args.Path)
							if err != nil {
								return esbuild.OnLoadResult{}, err
							}
							newContents := string(contents)
							if !strings.Contains(args.Path, ".sst") {
								newContents = input.Globals + "\n" + newContents
							}
							return esbuild.OnLoadResult{
								Contents: &newContents,
								Loader:   esbuild.LoaderDefault,
							}, nil
						})
				},
			},
		},
		External: []string{
			"@pulumi/*",
			"undici",
			"@pulumiverse/*",
			"@sst-provider/*",
			"@aws-sdk/*",
			"esbuild",
			"archiver",
			"glob",
			"vite", // The remix component uses vite to resolve the user's vite config file. We don't want to bundle it.
		},
		Define:   input.Define,
		Inject:   input.Inject,
		Outfile:  outfile,
		Write:    true,
		Bundle:   true,
		Metafile: true,
	})
	if len(result.Errors) > 0 {
		for _, err := range result.Errors {
			slog.Error("esbuild error", "text", err.Text)
		}
		return result, fmt.Errorf("%s", FormatError(result.Errors))
	}
	slog.Info("esbuild built", "outfile", outfile)

	analysis := esbuild.AnalyzeMetafile(result.Metafile, esbuild.AnalyzeMetafileOptions{
		Verbose: true,
	})
	os.WriteFile(filepath.Join(input.Dir, ".sst", "esbuild.json"), []byte(analysis), 0644)

	return result, nil
}

func FormatError(input []esbuild.Message) string {
	lines := []string{}
	for _, err := range input {
		if err.Location == nil {
			lines = append(lines, fmt.Sprintf("%v", err.Text))
			continue
		}
		lines = append(lines, fmt.Sprintf("%v:%v:%v: %v", err.Location.File, err.Location.Line, err.Location.Column, err.Text))
	}
	return strings.Join(lines, "\n")
}

func Cleanup(result esbuild.BuildResult) {
	for _, file := range result.OutputFiles {
		os.Remove(file.Path)
	}
}
