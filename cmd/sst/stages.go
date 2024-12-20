package main

import (
	"fmt"

	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/pkg/project/provider"
)

var CmdListStages = &cli.Command{
	Name: "stages",
	Description: cli.Description{
		Short: "List all deployed stages",
		Long:  `List all deployed stages for this application.`,
	},
	Run: func(c *cli.Cli) error {
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		defer p.Cleanup()
		backend := p.Backend()

		stages, err := provider.ListStages(backend, p.App().Name)

		for _, stage := range stages {
			fmt.Println(stage)
		}

		return nil
	},
}
