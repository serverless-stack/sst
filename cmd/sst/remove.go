package main

import (
	"strings"

	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/project"
	"github.com/sst/sst/v3/pkg/server"
	"golang.org/x/sync/errgroup"
)

func CmdRemove(c *cli.Cli) error {
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
	ui := ui.New(c.Context)
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
			ui.Event(evt)
		}
		return nil
	})
	defer ui.Destroy()
	defer c.Cancel()
	err = p.Run(c.Context, &project.StackInput{
		Command:    "remove",
		Target:     target,
		ServerPort: s.Port,
		Verbose:    c.Bool("verbose"),
	})
	if err != nil {
		return err
	}
	return nil
}
