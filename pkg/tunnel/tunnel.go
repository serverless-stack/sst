package tunnel

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/xjasonlyu/tun2socks/v2/engine"

	"github.com/sst/sst/v3/pkg/process"
)

// Platform-specific interface
type tunnelPlatform interface {
	destroy() error
	start(routes ...string) error
	install() error
}

var impl tunnelPlatform

var BINARY_PATH = "/opt/sst/tunnel"

func NeedsInstall() bool {
	if _, err := os.Stat(BINARY_PATH); err == nil {
		return false
	}
	return true
}

func Install() error {
	return impl.install()
}

func runCommands(cmds [][]string) error {
	for _, item := range cmds {
		slog.Info("running command", "command", item)
		cmd := process.Command(item[0], item[1:]...)
		err := cmd.Run()
		if err != nil {
			slog.Error("failed to execute command", "command", item, "error", err)
			return fmt.Errorf("failed to execute command '%v': %v", item, err)
		}
	}
	return nil
}

func Start(routes ...string) error {
	return impl.start(routes...)
}

func tun2socks(name string) {
	key := new(engine.Key)
	key.Device = name
	key.Proxy = "socks5://127.0.0.1:1080"
	engine.Insert(key)
	engine.Start()
}

func Stop() {
	engine.Stop()
	impl.destroy()
}
