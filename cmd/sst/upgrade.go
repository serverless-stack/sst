package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/fatih/color"
	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/cmd/sst/mosaic/ui"
	"github.com/sst/ion/pkg/global"
	"github.com/sst/ion/pkg/process"
)

func CmdUpgrade(c *cli.Cli) error {
	if os.Getenv("npm_config_user_agent") != "" {
		updated, err := global.UpgradeNode(
			version,
			c.Positional(0),
		)
		if err != nil {
			return err
		}
		hasAny := false
		for file, newVersion := range updated {
			fmt.Print(ui.TEXT_SUCCESS_BOLD.Render(ui.IconCheck) + "  ")
			fmt.Println(ui.TEXT_NORMAL.Render(file))
			fmt.Println("   " + ui.TEXT_DIM.Render(newVersion))
			if newVersion != version {
				hasAny = true
			}
		}
		if hasAny {
			var cmd *exec.Cmd
			if _, err := os.Stat("package-lock.json"); err == nil {
				cmd = process.Command("npm", "install")
			}
			if _, err := os.Stat("yarn.lock"); err == nil {
				cmd = process.Command("yarn", "install")
			}
			if _, err := os.Stat("pnpm-lock.yaml"); err == nil {
				cmd = process.Command("pnpm", "install")
			}
			if _, err := os.Stat("bun.lockb"); err == nil {
				cmd = process.Command("bun", "install")
			}
			if cmd != nil {
				fmt.Println()
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				cmd.Stdin = os.Stdin
				err := cmd.Run()
				if err != nil {
					return err
				}
			}
		}
		return nil
	}
	newVersion, err := global.Upgrade(
		version,
		c.Positional(0),
	)
	if err != nil {
		return err
	}
	newVersion = strings.TrimPrefix(newVersion, "v")
	fmt.Print(ui.TEXT_SUCCESS_BOLD.Render(ui.IconCheck))
	if newVersion == version {
		color.New(color.FgWhite).Printf("  Already on latest %s\n", version)
	} else {
		color.New(color.FgWhite).Printf("  Upgraded %s ➜ ", version)
		color.New(color.FgCyan, color.Bold).Println(newVersion)
	}
	return nil
}
