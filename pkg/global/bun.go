package global

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/klauspost/cpuid/v2"
	"github.com/sst/sst/v3/pkg/flag"
	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/task"
)

func BunPath() string {
	return filepath.Join(BinPath(), "bun")
}

func NeedsBun() bool {
	if flag.NO_BUN {
		return false
	}
	path := BunPath()
	slog.Info("checking for bun", "path", path)
	if _, err := os.Stat(path); err != nil {
		return true
	}
	cmd := process.Command(path, "--version")
	output, err := cmd.Output()
	if err != nil {
		return true
	}
	version := strings.TrimSpace(string(output))
	return version != BUN_VERSION
}

func InstallBun(ctx context.Context) error {
	slog.Info("bun install")
	bunPath := BunPath()

	goos := runtime.GOOS
	arch := runtime.GOARCH

	// Check for MUSL on Linux
	isMusl := false
	if goos == "linux" {
		if _, err := os.Stat("/lib/ld-musl-x86_64.so.1"); err == nil {
			isMusl = true
		} else {
			cmd := exec.Command("ldd", "--version")
			if output, err := cmd.CombinedOutput(); err == nil {
				isMusl = strings.Contains(strings.ToLower(string(output)), "musl")
			}
		}
	}

	var filename string
	switch {
	case goos == "darwin" && arch == "arm64":
		filename = "bun-darwin-aarch64.zip"
	case goos == "darwin" && arch == "amd64":
		if cpuid.CPU.Has(cpuid.AVX2) {
			filename = "bun-darwin-x64.zip"
		}
		filename = "bun-darwin-x64-baseline.zip"
	case goos == "linux" && arch == "arm64":
		if isMusl {
			filename = "bun-linux-aarch64-musl.zip"
		}
		filename = "bun-linux-aarch64.zip"
	case goos == "linux" && arch == "amd64":
		if isMusl {
			if cpuid.CPU.Has(cpuid.AVX2) {
				filename = "bun-linux-x64-musl.zip"
			}
			filename = "bun-linux-x64-musl-baseline.zip"
		}
		if cpuid.CPU.Has(cpuid.AVX2) {
			filename = "bun-linux-x64.zip"
		}
		filename = "bun-linux-x64-baseline.zip"
	case goos == "windows" && arch == "amd64":
		if cpuid.CPU.Has(cpuid.AVX2) {
			filename = "bun-windows-x64.zip"
		}
		filename = "bun-windows-x64-baseline.zip"
	default:
	}
	if filename == "" {
		return fmt.Errorf("unsupported platform: %s %s", goos, arch)
	}
	slog.Info("bun selected", "filename", filename)

	_, err := task.Run(ctx, func() (any, error) {
		url := "https://github.com/oven-sh/bun/releases//download/bun-v" + BUN_VERSION + "/" + filename
		slog.Info("bun downloading", "url", url)
		response, err := http.Get(url)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("bad status: %s", response.Status)
		}
		bodyBytes, err := io.ReadAll(response.Body)
		if err != nil {
			return nil, err
		}
		readerAt := bytes.NewReader(bodyBytes)
		zipReader, err := zip.NewReader(readerAt, readerAt.Size())
		if err != nil {
			return nil, err
		}
		for _, file := range zipReader.File {
			if filepath.Base(file.Name) == "bun" {
				f, err := file.Open()
				if err != nil {
					return nil, err
				}
				defer f.Close()

				tmpFile := filepath.Join(BinPath(), id.Ascending())
				outFile, err := os.Create(tmpFile)
				if err != nil {
					return nil, err
				}
				defer outFile.Close()

				_, err = io.Copy(outFile, f)
				if err != nil {
					return nil, err
				}
				err = outFile.Close()
				if err != nil {
					return nil, err
				}

				err = os.Rename(tmpFile, bunPath)
				if err != nil {
					return nil, err
				}

				err = os.Chmod(bunPath, 0755)
				if err != nil {
					return nil, err
				}
			}
		}
		return nil, nil
	})
	return err
}
