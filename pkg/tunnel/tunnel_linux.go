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

type linuxPlatform struct{}

func init() {
	impl = &linuxPlatform{}
}

func (p *linuxPlatform) install() error {
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
	// Linux-specific visudo flag
	cmd := process.Command("visudo", "-c", "-f", sudoersPath)
	slog.Info("running visudo", "cmd", cmd.Args)
	err = cmd.Run()
	if err != nil {
		slog.Error("failed to run visudo", "error", err)
		os.Remove(sudoersPath)
		return util.NewReadableError(err, "Error validating sudoers file")
	}
	return nil
}

func (p *linuxPlatform) start(routes ...string) error {
	name := resolveInterface()
	p.destroy()
	slog.Info("creating interface", "name", name, "os", runtime.GOOS)
	cmds := [][]string{
		{"ip", "tuntap", "add", name, "mode", "tun"},
		{"ip", "addr", "add", "172.16.0.1", "dev", name},
		{"ip", "link", "set", "dev", name, "up"},
	}
	for _, route := range routes {
		cmds = append(cmds, []string{
			"ip", "route", "add", route, "dev", name,
		})
	}
	err := runCommands(cmds)
	if err != nil {
		return err
	}
	tun2socks(name)
	return nil
}

func (p *linuxPlatform) destroy() error {
	name := resolveInterface()
	return runCommands([][]string{
		{"ip", "link", "set", "dev", name, "down"},
		{"ip", "tuntap", "del", "dev", name, "mode", "tun"},
	})
}

func resolveInterface() string {
	return "sst"
}
