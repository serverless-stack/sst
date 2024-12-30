package tunnel

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

	"github.com/sst/sst/v3/internal/util"
	"github.com/sst/sst/v3/pkg/process"
)

type darwinPlatform struct{}

func init() {
	impl = &darwinPlatform{}
}

func (p *darwinPlatform) install() error {
	sourcePath, err := os.Executable()
	if err != nil {
		return err
	}
	os.RemoveAll(filepath.Dir(BINARY_PATH))
	os.MkdirAll(filepath.Dir(BINARY_PATH), 0755)
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer sourceFile.Close()
	destFile, err := os.Create(BINARY_PATH)
	if err != nil {
		return err
	}
	defer destFile.Close()
	_, err = io.Copy(destFile, sourceFile)
	if err != nil {
		return err
	}
	err = os.Chmod(BINARY_PATH, 0755)
	user := os.Getenv("SUDO_USER")
	sudoersPath := "/etc/sudoers.d/sst-" + user
	slog.Info("creating sudoers file", "path", sudoersPath)
	command := BINARY_PATH + " tunnel start *"
	sudoersEntry := fmt.Sprintf("%s ALL=(ALL) NOPASSWD:SETENV: %s\n", user, command)
	slog.Info("sudoers entry", "entry", sudoersEntry)
	err = os.WriteFile(sudoersPath, []byte(sudoersEntry), 0440)
	if err != nil {
		return err
	}
	// Darwin-specific visudo flag
	cmd := process.Command("visudo", "-cf", sudoersPath)
	slog.Info("running visudo", "cmd", cmd.Args)
	err = cmd.Run()
	if err != nil {
		slog.Error("failed to run visudo", "error", err)
		os.Remove(sudoersPath)
		return util.NewReadableError(err, "Error validating sudoers file")
	}
	return nil
}

func (p *darwinPlatform) start(routes ...string) error {
	p.destroy()
	name := "utun69"
	slog.Info("creating interface", "name", name, "os", runtime.GOOS)
	tun2socks(name)
	cmds := [][]string{
		{"ifconfig", "utun69", "172.16.0.1", "172.16.0.1", "netmask", "255.255.0.0", "up"},
	}
	for _, route := range routes {
		cmds = append(cmds, []string{
			"route", "add", "-net", route, "-interface", name,
		})
	}
	return runCommands(cmds)
}

func (p *darwinPlatform) destroy() error {
	return runCommands([][]string{
		{"ifconfig", "utun69", "destroy"},
	})
}
