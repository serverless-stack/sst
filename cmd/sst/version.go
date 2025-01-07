package main

import (
	"fmt"

	"github.com/pulumi/pulumi/sdk/v3"
	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/pkg/global"
)

var CmdVersion = &cli.Command{
	Name: "version",
	Description: cli.Description{
		Short: "Print the version of the CLI",
		Long:  `Prints the current version of the CLI.`,
	},
	Run: func(cli *cli.Cli) error {
		fmt.Println("sst", version)
		if cli.Bool("verbose") {
			fmt.Println("pulumi", sdk.Version)
			fmt.Println("config", global.ConfigDir())
		}
		return nil
	},
}
