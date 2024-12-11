package project

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/sst/ion/internal/fs"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/flag"
	"github.com/sst/ion/pkg/js"
	"github.com/sst/ion/pkg/process"
	"github.com/sst/ion/pkg/project/provider"
	"github.com/sst/ion/pkg/runtime"
	"github.com/sst/ion/pkg/runtime/node"
	"github.com/sst/ion/pkg/runtime/python"
	"github.com/sst/ion/pkg/runtime/worker"
)

type App struct {
	Name      string                 `json:"name"`
	Stage     string                 `json:"stage"`
	Removal   string                 `json:"removal"`
	Providers map[string]interface{} `json:"providers"`
	Home      string                 `json:"home"`
	Version   string                 `json:"version"`
	Protect   bool                   `json:"protect"`
	// Deprecated: Backend is now Home
	Backend string `json:"backend"`
	// Deprecated: RemovalPolicy is now Removal
	RemovalPolicy string `json:"removalPolicy"`
}

type Project struct {
	version         string
	lock            ProviderLock
	root            string
	config          string
	app             *App
	home            provider.Home
	env             map[string]string
	loadedProviders map[string]provider.Provider
	Runtime         *runtime.Collection
}

func Discover() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	cfgPath, err := fs.FindUp(cwd, "sst.config.ts")
	if err != nil {
		return "", err
	}
	err = os.MkdirAll(ResolveWorkingDir(cfgPath), 0755)
	if err != nil {
		return "", err
	}
	return cfgPath, nil
}

func ResolveWorkingDir(cfgPath string) string {
	return filepath.Join(filepath.Dir(cfgPath), ".sst")
}

func ResolvePlatformDir(cfgPath string) string {
	return filepath.Join(ResolveWorkingDir(cfgPath), "platform")
}

func ResolveLogDir(cfgPath string) string {
	return filepath.Join(ResolveWorkingDir(cfgPath), "log")
}

type ProjectConfig struct {
	Version string
	Stage   string
	Config  string
}

var ErrInvalidStageName = fmt.Errorf("invalid stage name")
var ErrInvalidAppName = fmt.Errorf("invalid app name")
var ErrAppNameChanged = fmt.Errorf("app name changed")
var ErrV2Config = fmt.Errorf("sstv2 config detected")
var ErrBuildFailed = fmt.Errorf("")
var ErrVersionInvalid = fmt.Errorf("invalid version")
var ErrVersionMismatch = fmt.Errorf("")

var InvalidStageRegex = regexp.MustCompile(`[^a-zA-Z0-9-]`)
var InvalidAppRegex = regexp.MustCompile(`[^a-zA-Z0-9-]`)

func New(input *ProjectConfig) (*Project, error) {
	if InvalidStageRegex.MatchString(input.Stage) {
		return nil, ErrInvalidStageName
	}

	rootPath := filepath.Dir(input.Config)

	proj := &Project{
		version: input.Version,
		root:    rootPath,
		config:  input.Config,
		env:     map[string]string{},
		Runtime: runtime.NewCollection(
			input.Config,
			node.New(input.Version),
			worker.New(),
			python.New(),
		),
	}
	tmp := proj.PathWorkingDir()

	_, err := os.Stat(tmp)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}
		err := os.Mkdir(tmp, 0755)
		if err != nil {
			return nil, err
		}
	}

	inputBytes, err := json.Marshal(map[string]string{
		"stage": input.Stage,
	})
	buildResult, err := js.Build(
		js.EvalOptions{
			Dir:    proj.PathRoot(),
			Banner: `function $config(input) { return input }`,
			Define: map[string]string{
				"$input": string(inputBytes),
			},
			Code: fmt.Sprintf(`
import mod from '%s';
if (mod.stacks || mod.config) {
  console.log("~v2")
  process.exit(0)
}
console.log("~j" + JSON.stringify(mod.app({
  stage: $input.stage || undefined,
})))`,
				input.Config),
		},
	)
	if err != nil {
		return nil, fmt.Errorf("%w%s", ErrBuildFailed, err)
	}
	defer js.Cleanup(buildResult)

	slog.Info("evaluating config")
	node := process.Command("node", "--no-warnings", string(buildResult.OutputFiles[1].Path))
	output, err := node.CombinedOutput()
	slog.Info("config evaluated")
	if err != nil {
		return nil, fmt.Errorf("Error evaluating config: %w\n%s", err, output)
	}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "~v2" {
			return nil, ErrV2Config
		}
		if strings.HasPrefix(line, "~j") {
			var parsed App
			err = json.Unmarshal([]byte(line[2:]), &parsed)
			if err != nil {
				return nil, err
			}
			proj.app = &parsed
			proj.app.Stage = input.Stage

			if proj.app.Providers == nil {
				proj.app.Providers = map[string]interface{}{}
			}

			for name, args := range proj.app.Providers {
				if argsBool, ok := args.(bool); ok && argsBool {
					proj.app.Providers[name] = make(map[string]interface{})
				}

				if argsString, ok := args.(string); ok {
					proj.app.Providers[name] = map[string]interface{}{
						"version": argsString,
					}
				}
			}

			if proj.app.Name == "" {
				return nil, fmt.Errorf("Project name is required")
			}

			if InvalidAppRegex.MatchString(proj.app.Name) {
				return nil, ErrInvalidAppName
			}

			// Check if app name has changed by comparing the folder name inside ".pulumi/stacks"
			// and the app name in the config file.
			stacksDir := filepath.Join(proj.PathWorkingDir(), ".pulumi", "stacks")
			files, err := os.ReadDir(stacksDir)
			if err != nil {
				if !os.IsNotExist(err) {
					return nil, err
				}
				files = []os.DirEntry{}
			}
			if len(files) > 0 {
				appName := files[0].Name()
				if appName != proj.app.Name {
					return nil, ErrAppNameChanged
				}
			}

			if proj.app.Home == "" {
				return nil, util.NewReadableError(nil, `You must specify a "home" provider in the project configuration file.`)
			}

			if _, ok := proj.app.Providers[proj.app.Home]; !ok && proj.app.Home != "local" {
				proj.app.Providers[proj.app.Home] = map[string]interface{}{}
			}

			if proj.app.RemovalPolicy != "" {
				return nil, util.NewReadableError(nil, `The "removalPolicy" has been renamed to "removal"`)
			}

			if proj.app.Removal == "" {
				proj.app.Removal = "retain"
			}

			if proj.app.Version != "" && input.Version != "dev" {
				constraint, err := semver.NewConstraint(proj.app.Version)
				if err != nil {
					return nil, ErrVersionInvalid
				}
				version, err := semver.NewVersion(input.Version)
				if err != nil {
					return nil, ErrVersionInvalid
				}
				if !constraint.Check(version) {
					return nil, fmt.Errorf("%wYou are using v%s which does not match v%s in your \"sst.config.ts\".", ErrVersionMismatch, input.Version, proj.app.Version)
				}
			}

			if proj.app.Removal != "remove" && proj.app.Removal != "retain" && proj.app.Removal != "retain-all" {
				return nil, fmt.Errorf("Removal must be one of: remove, retain, retain-all")
			}
			continue
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	err = proj.loadProviderLock()
	if err != nil {
		return nil, err
	}

	return proj, nil
}

func (proj *Project) LoadHome() error {
	slog.Info("loading home")
	loadedProviders := make(map[string]provider.Provider)

	for key, args := range proj.app.Providers {
		var match provider.Provider
		switch key {
		case "cloudflare":
			match = &provider.CloudflareProvider{}
		case "aws":
			match = provider.NewAwsProvider()
		}
		if match == nil {
			continue
		}
		err := match.Init(proj.app.Name, proj.app.Stage, args.(map[string]interface{}))
		if err != nil {
			return util.NewReadableError(err, key+": "+err.Error())
		}
		env, err := match.Env()
		if err != nil {
			return err
		}
		for key, value := range env {
			proj.env[key] = value
		}
		loadedProviders[key] = match
	}

	var home provider.Home

	switch proj.app.Home {
	case "local":
		home = provider.NewLocalHome()
	case "aws":
		home = provider.NewAwsHome(loadedProviders["aws"].(*provider.AwsProvider))
	case "cloudflare":
		home = provider.NewCloudflareHome(loadedProviders["cloudflare"].(*provider.CloudflareProvider))
	default:
		return fmt.Errorf("Home provider %s is invalid", proj.app.Home)
	}

	err := home.Bootstrap()
	if err != nil {
		return fmt.Errorf("Error initializing %s:\n   %w", proj.app.Home, err)
	}
	proj.home = home
	proj.loadedProviders = loadedProviders
	return nil
}

func (p Project) getPath(path ...string) string {
	paths := append([]string{p.PathWorkingDir()}, path...)
	return filepath.Join(paths...)
}

func (p Project) PathWorkingDir() string {
	return filepath.Join(p.root, ".sst")
}

func (p Project) PathPlatformDir() string {
	return filepath.Join(p.PathWorkingDir(), "platform")
}

func (p Project) PathRoot() string {
	return p.root
}

func (p Project) PathConfig() string {
	return p.config
}

func (p Project) Version() string {
	return p.version
}

func (p Project) App() *App {
	return p.app
}

func (p Project) Backend() provider.Home {
	return p.home
}

func (p Project) Env() map[string]string {
	return p.env
}

func (p *Project) Provider(name string) (provider.Provider, bool) {
	result, ok := p.loadedProviders[name]
	return result, ok
}

func (p *Project) Cleanup() error {
	if flag.SST_NO_CLEANUP {
		return nil
	}
	return nil
}

func (p *Project) PathLog(name string) string {
	if name == "" {
		return filepath.Join(p.PathWorkingDir(), "log")
	}
	return filepath.Join(p.PathWorkingDir(), "log", name+".log")
}
