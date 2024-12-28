package main

import "github.com/sst/sst/v3/cmd/sst/cli"

var CmdStateCopy = &cli.Command{
	Name: "copy",
	Description: cli.Description{
		Short: "Copy state from one home to another.",
	},
	Args: []cli.Argument{
		{
			Name: "to",
			Description: cli.Description{
				Short: "The destination home",
			},
		},
	},
	Run: func(cli *cli.Cli) error {
		return nil
	},
}
