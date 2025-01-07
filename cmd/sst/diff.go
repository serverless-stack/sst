package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/project"
	"github.com/sst/sst/v3/pkg/server"
	"github.com/yalp/jsonpath"
	"golang.org/x/sync/errgroup"
)

func CmdDiff(c *cli.Cli) error {
	p, err := c.InitProject()
	if err != nil {
		return err
	}
	defer p.Cleanup()

	target := []string{}
	if c.String("target") != "" {
		target = strings.Split(c.String("target"), ",")
	}

	var wg errgroup.Group
	defer wg.Wait()
	outputs := []*apitype.ResOutputsEvent{}
	u := ui.New(c.Context)
	s, err := server.New()
	if err != nil {
		return err
	}
	wg.Go(func() error {
		defer c.Cancel()
		return s.Start(c.Context, p)
	})

	events := bus.SubscribeAll()
	defer close(events)
	wg.Go(func() error {
		for evt := range events {
			u.Event(evt)
			switch evt := evt.(type) {
			case *apitype.ResOutputsEvent:
				outputs = append(outputs, evt)
			}
		}
		return nil
	})
	defer u.Destroy()
	defer c.Cancel()
	err = p.Run(c.Context, &project.StackInput{
		Command:    "diff",
		ServerPort: s.Port,
		Dev:        c.Bool("dev"),
		Target:     target,
		Verbose:    c.Bool("verbose"),
	})
	if err != nil {
		return err
	}
	if len(outputs) == 0 {
		fmt.Println(
			ui.TEXT_HIGHLIGHT_BOLD.Render("➜"),
			ui.TEXT_NORMAL_BOLD.Render(" No changes"),
		)
		fmt.Println()
		return nil
	}
	for _, output := range outputs {
		icon := ""
		if output.Metadata.Op == apitype.OpImport {
			icon = ui.TEXT_SUCCESS_BOLD.Render("+")
		}
		if output.Metadata.Op == apitype.OpDelete {
			icon = ui.TEXT_DANGER_BOLD.Render("-")
		}
		if output.Metadata.Op == apitype.OpReplace {
			icon = ui.TEXT_SUCCESS_BOLD.Render("+")
		}
		if output.Metadata.Op == apitype.OpUpdate {
			icon = ui.TEXT_WARNING_BOLD.Render("*")
		}
		if output.Metadata.Op == apitype.OpCreate {
			icon = ui.TEXT_SUCCESS_BOLD.Render("+")
		}
		if icon == "" {
			continue
		}

		fmt.Println(icon, "", ui.TEXT_NORMAL_BOLD.Render(u.FormatURN(output.Metadata.URN)))
		sorted := make([]string, 0, len(output.Metadata.DetailedDiff))
		for path := range output.Metadata.DetailedDiff {
			sorted = append(sorted, path)
		}
		sort.Strings(sorted)
		for _, path := range sorted {
			diff := output.Metadata.DetailedDiff[path]
			label := ""
			if diff.Kind == apitype.DiffUpdate {
				label = ui.TEXT_WARNING_BOLD.Render("*")
			}
			if diff.Kind == apitype.DiffDelete {
				label = ui.TEXT_DANGER_BOLD.Render("-")
			}
			if diff.Kind == apitype.DiffAdd {
				label = ui.TEXT_SUCCESS_BOLD.Render("+")
			}
			if diff.Kind == apitype.DiffAddReplace {
				label = ui.TEXT_SUCCESS_BOLD.Render("+")
			}
			if diff.Kind == apitype.DiffUpdateReplace {
				label = ui.TEXT_WARNING_BOLD.Render("*")
			}
			if diff.Kind == apitype.DiffDeleteReplace {
				label = ui.TEXT_DANGER_BOLD.Render("-")
			}
			fmt.Print("   ", label+" ", strings.TrimSpace(path))
			value, _ := jsonpath.Read(output.Metadata.New.Outputs, "$."+path)
			if path == "__provider" {
				value = "code changed"
			}
			if value != nil {
				formatted := ""
				switch value.(type) {
				case string:
					formatted = value.(string)
				default:
					bytes, _ := json.MarshalIndent(value, "", "  ")
					formatted = string(bytes)
				}
				lines := strings.Split(string(formatted), "\n")
				fmt.Print(" = ")
				for index, line := range lines {
					if index > 0 {
						fmt.Print("     ")
					}
					fmt.Print(ui.TEXT_DIM.Render(line) + "\n")
				}
			} else {
				fmt.Println()
			}
		}
		fmt.Println()
	}
	return nil
}
