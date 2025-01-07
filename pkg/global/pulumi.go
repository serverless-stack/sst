package global

import (
	"compress/gzip"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/task"
)

func NeedsPulumi() bool {
	path := PulumiPath()
	slog.Info("checking for pulumi", "path", path)
	if _, err := os.Stat(path); err != nil {
		return true
	}
	cmd := process.Command(path, "version")
	output, err := cmd.Output()
	if err != nil {
		return true
	}
	version := strings.TrimSpace(string(output))
	return version != PULUMI_VERSION
}

func InstallPulumi(ctx context.Context) error {
	slog.Info("pulumi install")
	var osArch string

	switch runtime.GOOS {
	case "darwin":
		osArch = "darwin"
	case "linux":
		osArch = "linux"
	case "windows":
		osArch = "windows"
	default:
		return fmt.Errorf("unsupported operating system")
	}

	switch runtime.GOARCH {
	case "amd64":
		osArch += "-x64"
	case "arm64":
		osArch += "-arm64"
	default:
		return fmt.Errorf("unsupported architecture: " + runtime.GOARCH)
	}

	fileExtension := ".tar.gz"
	if runtime.GOOS == "windows" {
		fileExtension = ".zip"
	}

	_, err := task.Run(ctx, func() (any, error) {
		url := fmt.Sprintf("https://github.com/pulumi/pulumi/releases/download/%v/pulumi-%s-%s%s", PULUMI_VERSION, PULUMI_VERSION, osArch, fileExtension)
		slog.Info("pulumi downloading", "url", url)

		resp, err := http.Get(url)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("failed to download pulumi: HTTP status %d", resp.StatusCode)
		}

		tmp := filepath.Join(BinPath(), id.Ascending())
		err = os.MkdirAll(tmp, 0755)
		if err != nil {
			return nil, err
		}
		switch fileExtension {
		case ".tar.gz":
			gzr, err := gzip.NewReader(resp.Body)
			if err != nil {
				return nil, err
			}
			defer gzr.Close()
			err = untar(gzr, tmp)
			if err != nil {
				return nil, err
			}

		default:
			return nil, fmt.Errorf("cannot extract zip file for pulumi")
		}

		entries, err := os.ReadDir(tmp)
		if err != nil {
			return nil, err
		}
		for _, file := range entries {
			err = os.Rename(filepath.Join(tmp, file.Name()), filepath.Join(BinPath(), file.Name()))
			if err != nil {
				return nil, err
			}
		}
		os.RemoveAll(tmp)
		return nil, nil
	})
	return err
}

func PulumiPath() string {
	return filepath.Join(BinPath(), "pulumi")
}
