package project

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/sst/sst/v3/pkg/js"
	"github.com/sst/sst/v3/platform"
)

func (p *Project) CheckPlatform(version string) bool {
	if version == "dev" {
		currentExecutable, _ := os.Executable()
		info, _ := os.Stat(currentExecutable)
		version = fmt.Sprint(info.ModTime().UnixMilli())
	}
	slog.Info("checking platform")
	contents, err := os.ReadFile(filepath.Join(p.PathPlatformDir(), "version"))
	if err != nil {
		return false
	}
	return string(contents) == version
}

func (p *Project) CopyPlatform(version string) error {
	slog.Info("installing platform")
	platformDir := p.PathPlatformDir()
	os.RemoveAll(filepath.Join(platformDir))
	err := platform.CopyTo(".", platformDir)
	if err != nil {
		return err
	}
	p.lock = ProviderLock{}
	if version == "dev" {
		currentExecutable, _ := os.Executable()
		info, _ := os.Stat(currentExecutable)
		version = fmt.Sprint(info.ModTime().UnixMilli())
	}
	return os.WriteFile(filepath.Join(platformDir, "version"), []byte(version), 0644)
}

func getPackageJson(proj *Project, pkg string) (*js.PackageJson, error) {
	data, err := os.ReadFile(
		filepath.Join(
			proj.PathWorkingDir(),
			"node_modules",
			pkg,
			"package.json",
		),
	)

	if err != nil {
		return nil, err
	}

	var parsed js.PackageJson
	err = json.Unmarshal(data, &parsed)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}
