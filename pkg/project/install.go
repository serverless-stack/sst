package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/Masterminds/semver/v3"
	"github.com/sst/ion/pkg/flag"
	"github.com/sst/ion/pkg/global"
	"github.com/sst/ion/pkg/npm"
	"github.com/sst/ion/pkg/process"
	"github.com/sst/ion/platform"
	"golang.org/x/sync/errgroup"
)

type ErrProviderVersionTooLow struct {
	Name    string
	Version string
	Needed  string
}

func (err *ErrProviderVersionTooLow) Error() string {
	return "provider version too low"
}

func (p *Project) NeedsInstall() bool {
	if len(p.app.Providers) != len(p.lock) {
		return true
	}
	for _, entry := range p.lock {
		config := p.app.Providers[entry.Name].(map[string]interface{})
		version := config["version"]
		if version == nil || version == "" {
			continue
		}
		slog.Info("checking provider", "name", entry.Name, "version", version, "compare", entry.Version)
		if version != entry.Version {
			return true
		}
	}
	return false
}

func (p *Project) Install() error {
	slog.Info("installing deps")

	err := p.generateProviderLock()
	if err != nil {
		return err
	}

	err = p.writePackageJson()
	if err != nil {
		return err
	}

	err = p.fetchDeps()
	if err != nil {
		return err
	}

	err = p.writeTypes()
	if err != nil {
		return err
	}

	err = p.writeProviderLock()
	if err != nil {
		return err
	}

	return nil
}

func (p *Project) writePackageJson() error {
	slog.Info("writing package.json")
	packageJsonPath := filepath.Join(p.PathPlatformDir(), "package.json")
	packageJson, err := os.OpenFile(packageJsonPath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		return err
	}
	defer packageJson.Close()

	var data []byte
	data, err = io.ReadAll(packageJson)
	if err != nil {
		return err
	}

	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		return err
	}

	dependencies := result["dependencies"].(map[string]interface{})
	for _, entry := range p.lock {
		slog.Info("adding dependency", "name", entry.Name)
		dependencies[entry.Package] = entry.Version
	}

	dataToWrite, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}

	if err := packageJson.Truncate(0); err != nil {
		return err
	}

	if _, err := packageJson.Seek(0, 0); err != nil {
		return err
	}

	if _, err := packageJson.Write(dataToWrite); err != nil {
		return err
	}
	return nil
}

func (p *Project) writeTypes() error {
	slog.Info("writing types")
	typesPath := filepath.Join(p.PathPlatformDir(), "config.d.ts")
	file, err := os.OpenFile(typesPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer file.Close()

	file.WriteString(`import "./src/global.d.ts"` + "\n")
	file.WriteString(`import "../types.generated"` + "\n")
	file.WriteString(`import { AppInput, App, Config } from "./src/config"` + "\n")

	for _, entry := range p.lock {
		file.WriteString(`import * as _` + entry.Alias + ` from "` + entry.Package + `";` + "\n")
	}

	file.WriteString("\n\n")

	file.WriteString(`declare global {` + "\n")
	for _, entry := range p.lock {
		file.WriteString(`  // @ts-expect-error` + "\n")
		file.WriteString(`  export import ` + entry.Alias + ` = _` + entry.Alias + "\n")
	}
	file.WriteString(`  interface Providers {` + "\n")
	file.WriteString(`    providers?: {` + "\n")
	for _, entry := range p.lock {
		file.WriteString(`      "` + entry.Name + `"?:  (_` + entry.Alias + `.ProviderArgs & { version?: string }) | boolean | string;` + "\n")
	}
	file.WriteString(`    }` + "\n")
	file.WriteString(`  }` + "\n")
	file.WriteString(`  export const $config: (` + "\n")
	file.WriteString(`    input: Omit<Config, "app"> & {` + "\n")
	file.WriteString(`      app(input: AppInput): Omit<App, "providers"> & Providers;` + "\n")
	file.WriteString(`    },` + "\n")
	file.WriteString(`  ) => Config;` + "\n")
	file.WriteString(`}` + "\n")

	return nil
}

func (p *Project) fetchDeps() error {
	slog.Info("fetching deps")
	manager := global.BunPath()
	if flag.NO_BUN {
		manager = "npm"
	}
	cmd := process.Command(manager, "install")
	cmd.Dir = p.PathPlatformDir()
	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.New("failed to run bun install " + string(output))
	}
	return nil
}

type ProviderLockEntry struct {
	Name    string `json:"name"`
	Package string `json:"package"`
	Version string `json:"version"`
	Alias   string `json:"alias"`
}

type ProviderLock = []*ProviderLockEntry

func (p *Project) loadProviderLock() error {
	lockPath := filepath.Join(p.PathPlatformDir(), "provider-lock.json")
	data, err := os.ReadFile(lockPath)
	if err != nil {
		p.lock = ProviderLock{}
		return nil
	}
	err = json.Unmarshal(data, &p.lock)
	if err != nil {
		return err
	}
	return nil
}

func (p *Project) generateProviderLock() error {
	var wg errgroup.Group
	out := ProviderLock{}
	results := make(chan ProviderLockEntry, 1000)
	pkg, err := platform.PackageJson()
	if err != nil {
		return err
	}
	for name, config := range p.app.Providers {
		n := name
		version := config.(map[string]interface{})["version"]
		if version == nil || version == "" {
			version = "latest"
		}
		wg.Go(func() error {
			result, err := FindProvider(n, version.(string))
			if err != nil {
				return err
			}
			if match, ok := pkg.Dependencies[result.Package]; ok {
				if version == "latest" {
					result.Version = match
				}
				if semver.MustParse(result.Version).Compare(semver.MustParse(match)) < 0 {
					results <- *result
					return &ErrProviderVersionTooLow{
						Name:    result.Name,
						Version: result.Version,
						Needed:  match,
					}
				}
			}
			results <- *result
			return nil
		})
	}
	err = wg.Wait()
	if err != nil {
		return err
	}
	for range p.app.Providers {
		r := <-results
		out = append(out, &r)
	}
	close(results)
	p.lock = out
	return nil
}

func FindProvider(name string, version string) (*ProviderLockEntry, error) {
	for _, prefix := range []string{"@sst-provider/", "@pulumi/", "@pulumiverse/", "pulumi-", "@", ""} {
		pkg, err := npm.Get(prefix+name, version)
		if err != nil {
			continue
		}
		if pkg.Pulumi == nil {
			continue
		}
		alias := pkg.Pulumi.Name
		if alias == "" || alias == "terraform-provider" {
			alias = pkg.Name
			alias = strings.ReplaceAll(alias, "@sst-provider", "")
			alias = strings.ReplaceAll(alias, "/", "")
			alias = strings.ReplaceAll(alias, "@", "")
			alias = strings.ReplaceAll(alias, "pulumi", "")
		}
		alias = strings.ReplaceAll(alias, "-", "")
		return &ProviderLockEntry{
			Name:    name,
			Package: pkg.Name,
			Version: pkg.Version,
			Alias:   alias,
		}, nil
	}
	return nil, fmt.Errorf("provider %s not found", name)
}

func (p *Project) writeProviderLock() error {
	lockPath := filepath.Join(p.PathPlatformDir(), "provider-lock.json")
	data, err := json.MarshalIndent(p.lock, "", "  ")
	if err != nil {
		return err
	}
	err = os.WriteFile(lockPath, data, 0644)
	if err != nil {
		return err
	}
	return nil
}
