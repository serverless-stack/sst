package tunnel

import (
	"log/slog"
	"runtime"
)

func Start(routes ...string) error {
	name := resolveInterface()
	destroy()
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

func destroy() error {
	name := resolveInterface()
	return runCommands([][]string{
		{"ip", "link", "set", "dev", name, "down"},
		{"ip", "tuntap", "del", "dev", name, "mode", "tun"},
	})
}

func resolveInterface() string {
	return "sst"
}
