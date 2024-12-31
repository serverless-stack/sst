package main

import (
	"fmt"

	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/pkg/project/provider"
)

func indent(key string) string {
	return fmt.Sprintf("%-12s", key)
}

func renderKeyValue(key string, value string) {
	fmt.Println(ui.TEXT_NORMAL_BOLD.Render(indent(key+":")) + ui.TEXT_INFO.Render(value))
}

var CmdListStages = &cli.Command{
	Name: "stages",
	Description: cli.Description{
		Short: "List all deployed stages",
		Long:  `List all deployed stages for this application.`,
	},
	Flags: []cli.Flag{
		{
			Name: "simple",
			Type: "bool",
			Description: cli.Description{
				Short: "Output a basic list of stages",
				Long:  "Output a basic list of stages without additional information about the provider.",
			},
		},
	},
	Run: func(c *cli.Cli) error {
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		defer p.Cleanup()
		backend := p.Backend()

		stages, err := provider.ListStages(backend, p.App().Name)
		if err != nil {
			return err
		}

		if c.Bool("simple") {
			for _, stage := range stages {
				fmt.Println(stage)
			}

			return nil
		}

		lines, err := provider.Info(backend)
		if err != nil {
			ui.Error("Failed to load provider information")
		}

		for _, line := range lines {
			renderKeyValue(line.Key, line.Value)
		}

		if len(stages) == 0 {
			return nil
		}

		renderKeyValue("Stages", stages[0])
		if len(stages) > 1 {
			for _, stage := range stages[1:] {
				fmt.Println(indent("") + ui.TEXT_INFO.Render(stage))
			}
		}

		return nil
	},
}
