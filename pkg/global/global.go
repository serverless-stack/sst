package global

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/pulumi/pulumi/sdk/v3"
	"github.com/sst/ion/pkg/flag"
	"github.com/sst/ion/pkg/process"
)

var PULUMI_VERSION = "v" + sdk.Version.String()
var BUN_VERSION = func() string {
	if flag.SST_BUN_VERSION != "" {
		return flag.SST_BUN_VERSION
	}
	return "1.1.30"
}()

const UV_VERSION = "0.3.2"

var configDir = (func() string {
	home, err := os.UserConfigDir()
	if err != nil {
		panic(err)
	}
	result := filepath.Join(home, "sst")
	os.Setenv("PATH", result+"/bin:"+os.Getenv("PATH"))
	os.MkdirAll(result, 0755)
	os.MkdirAll(filepath.Join(result, "bin"), 0755)
	return result
}())

func ConfigDir() string {
	return configDir
}

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

func InstallPulumi() error {
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

	url := fmt.Sprintf("https://github.com/pulumi/pulumi/releases/download/%v/pulumi-%s-%s%s", PULUMI_VERSION, PULUMI_VERSION, osArch, fileExtension)
	slog.Info("pulumi downloading", "url", url)

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download pulumi: HTTP status %d", resp.StatusCode)
	}

	tmp := filepath.Join(BinPath(), ".tmp")
	err = os.MkdirAll(tmp, 0755)
	if err != nil {
		return err
	}
	switch fileExtension {
	case ".tar.gz":
		gzr, err := gzip.NewReader(resp.Body)
		if err != nil {
			return err
		}
		defer gzr.Close()
		err = untar(gzr, tmp)
		if err != nil {
			return err
		}

	default:
		panic("cannot extract zip file for pulumi")
	}

	entries, err := os.ReadDir(tmp)
	if err != nil {
		return err
	}
	for _, file := range entries {
		err = os.Rename(filepath.Join(tmp, file.Name()), filepath.Join(BinPath(), file.Name()))
		if err != nil {
			return err
		}
	}
	os.RemoveAll(tmp)

	return nil
}

func PulumiPath() string {
	return filepath.Join(BinPath(), "pulumi")
}

func BunPath() string {
	return filepath.Join(BinPath(), "bun")
}

func BinPath() string {
	return filepath.Join(configDir, "bin")
}

func CertPath() string {
	return filepath.Join(configDir, "cert")
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

func InstallBun() error {
	slog.Info("bun install")
	goos := runtime.GOOS
	arch := runtime.GOARCH
	bunPath := BunPath()

	var filename string
	switch {
	case goos == "darwin" && arch == "arm64":
		filename = "bun-darwin-aarch64.zip"
	case goos == "darwin" && arch == "amd64":
		filename = "bun-darwin-x64-baseline.zip"
	case goos == "linux" && arch == "arm64":
		filename = "bun-linux-aarch64.zip"
	case goos == "linux" && arch == "amd64":
		filename = "bun-linux-x64-baseline.zip"
	default:
	}
	if filename == "" {
		return fmt.Errorf("unsupported platform: %s %s", goos, arch)
	}

	url := "https://github.com/oven-sh/bun/releases//download/bun-v" + BUN_VERSION + "/" + filename
	slog.Info("bun downloading", "url", url)
	response, err := http.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("bad status: %s", response.Status)
	}
	bodyBytes, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	readerAt := bytes.NewReader(bodyBytes)
	zipReader, err := zip.NewReader(readerAt, readerAt.Size())
	if err != nil {
		return err
	}
	for _, file := range zipReader.File {
		if filepath.Base(file.Name) == "bun" {
			f, err := file.Open()
			if err != nil {
				return err
			}
			defer f.Close()

			tmpFile := filepath.Join(BinPath(), "sst-bun-download")
			outFile, err := os.Create(tmpFile)
			if err != nil {
				return err
			}
			defer outFile.Close()

			_, err = io.Copy(outFile, f)
			if err != nil {
				return err
			}
			outFile.Close()

			err = os.Rename(tmpFile, bunPath)
			if err != nil {
				return err
			}

			err = os.Chmod(bunPath, 0755)
			if err != nil {
				return err
			}
		}
	}

	return nil
}
