package tunnel

import (
	"log/slog"
	"runtime"
)

func Start(routes ...string) error {
	destroy()
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
	err := runCommands(cmds)
	if err != nil {
		return err
	}
	return nil
}

func destroy() error {
	return runCommands([][]string{
		{"ifconfig", "utun69", "destroy"},
	})
}
