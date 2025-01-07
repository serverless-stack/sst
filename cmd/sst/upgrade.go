package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/fatih/color"
	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/npm"
	"github.com/sst/sst/v3/pkg/process"
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
			cwd, _ := os.Getwd()
			mgr := npm.DetectPackageManager(cwd)
			if mgr != "" {
				cmd := process.Command(mgr, "install")
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
