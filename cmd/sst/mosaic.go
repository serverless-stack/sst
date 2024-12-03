package main

import (
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/kballard/go-shellquote"
	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/cmd/sst/mosaic/aws"
	"github.com/sst/ion/cmd/sst/mosaic/cloudflare"
	"github.com/sst/ion/cmd/sst/mosaic/deployer"
	"github.com/sst/ion/cmd/sst/mosaic/dev"
	"github.com/sst/ion/cmd/sst/mosaic/multiplexer"
	"github.com/sst/ion/cmd/sst/mosaic/socket"
	"github.com/sst/ion/cmd/sst/mosaic/watcher"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/bus"
	"github.com/sst/ion/pkg/process"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/runtime"
	"github.com/sst/ion/pkg/server"
	"golang.org/x/sync/errgroup"
)

func CmdMosaic(c *cli.Cli) error {
	cwd, _ := os.Getwd()
	var wg errgroup.Group

	// spawning child process
	if len(c.Arguments()) > 0 {
		var args []string
		for _, arg := range c.Arguments() {
			args = append(args, strings.Fields(arg)...)
		}
		slog.Info("dev mode with target", "args", c.Arguments())
		cfgPath, err := project.Discover()
		stage, err := c.Stage(cfgPath)
		if err != nil {
			return err
		}
		url, err := server.Discover(cfgPath, stage)
		if err != nil {
			return err
		}
		slog.Info("found server", "url", url)
		evts, err := dev.Stream(c.Context, url, project.CompleteEvent{})
		if err != nil {
			return err
		}
		cwd, _ := os.Getwd()
		currentDir := cwd
		for {
			newPath := filepath.Join(currentDir, "node_modules", ".bin") + string(os.PathListSeparator) + os.Getenv("PATH")
			os.Setenv("PATH", newPath)
			parentDir := filepath.Dir(currentDir)
			if parentDir == currentDir {
				break
			}
			currentDir = parentDir
		}
		var cmd *exec.Cmd
		env := map[string]string{}
		processExited := make(chan bool)
		timeout := time.Minute * 50
		for {
			select {
			case <-c.Context.Done():
				return nil
			case <-processExited:
				c.Cancel()
				continue
			case <-time.After(timeout):
				env = map[string]string{}
				go func() {
					evts <- true
				}()
				fmt.Println("[timeout]")
				continue
			case _, ok := <-evts:
				if !ok {
					return nil
				}
				query := "directory=" + cwd
				if os.Getenv("SST_CHILD") != "" {
					query = "name=" + os.Getenv("SST_CHILD")
				}
				nextEnv, err := dev.Env(c.Context, query, url)
				if err != nil {
					return err
				}
				if _, ok := nextEnv["AWS_ACCESS_KEY_ID"]; ok {
					timeout = time.Minute * 45
				}
				if diff(env, nextEnv) {
					if cmd != nil && cmd.Process != nil {
						process.Kill(cmd.Process)
						<-processExited
						fmt.Println("\n[restarting]")
					}
					cmd = process.Command(
						args[0],
						args[1:]...,
					)
					cmd.Env = os.Environ()
					for k, v := range nextEnv {
						cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
					}
					cmd.Stdin = os.Stdin
					cmd.Stdout = os.Stdout
					cmd.Stderr = os.Stderr
					cmd.Start()
					go func() {
						cmd.Wait()
						processExited <- true
					}()
				}
				env = nextEnv
			}
		}
	}

	if os.Getenv("SST_SERVER") != "" {
		return util.NewReadableError(nil, "The dev command for this process does not look right. Check your dev script in package.json to make sure it is simply starting your process and not running `sst dev`. More info here: https://sst.dev/docs/reference/cli/#dev")
	}

	p, err := c.InitProject()
	if err != nil {
		return err
	}
	os.Setenv("SST_STAGE", p.App().Stage)
	slog.Info("mosaic", "project", p.PathRoot())

	wg.Go(func() error {
		defer c.Cancel()
		return watcher.Start(c.Context, p.PathRoot())
	})

	server, err := server.New()
	if err != nil {
		return err
	}

	wg.Go(func() error {
		defer c.Cancel()
		return dev.Start(c.Context, p, server)
	})

	wg.Go(func() error {
		defer c.Cancel()
		return socket.Start(c.Context, p, server)
	})

	wg.Go(func() error {
		evts := bus.Subscribe(&runtime.BuildInput{})
		for {
			select {
			case <-c.Context.Done():
				return nil
			case evt := <-evts:
				switch evt := evt.(type) {
				case *runtime.BuildInput:
					p.Runtime.AddTarget(evt)
				}
			}
		}
	})

	os.Setenv("SST_SERVER", fmt.Sprintf("http://localhost:%v", server.Port))
	for name, a := range p.App().Providers {
		args := a
		switch name {
		case "aws":
			wg.Go(func() error {
				defer c.Cancel()
				return aws.Start(c.Context, p, server, args.(map[string]interface{}))
			})
		case "cloudflare":
			wg.Go(func() error {
				defer c.Cancel()
				return cloudflare.Start(c.Context, p, args.(map[string]interface{}))
			})
		}
	}

	wg.Go(func() error {
		defer c.Cancel()
		return server.Start(c.Context, p)
	})

	currentExecutable, _ := os.Executable()

	mode := c.String("mode")
	if mode == "" {
		multi, err := multiplexer.New(c.Context)
		if err != nil {
			return err
		}
		multiEnv := append(
			c.Env(),
			fmt.Sprintf("SST_SERVER=http://localhost:%v", server.Port),
			"SST_STAGE="+p.App().Stage,
		)
		multi.AddProcess("deploy", []string{currentExecutable, "ui", "--filter=sst"}, "⑆", "SST", "", false, true, append(multiEnv, "SST_LOG="+p.PathLog("ui-deploy"))...)
		multi.AddProcess("function", []string{currentExecutable, "ui", "--filter=function"}, "λ", "Functions", "", false, true, append(multiEnv, "SST_LOG="+p.PathLog("ui-function"))...)
		wg.Go(func() error {
			defer c.Cancel()
			multi.Start()
			return nil
		})
		wg.Go(func() error {
			evts := bus.Subscribe(&project.CompleteEvent{})
			defer c.Cancel()
			for {
				select {
				case <-c.Context.Done():
					return nil
				case unknown := <-evts:
					switch evt := unknown.(type) {
					case *project.CompleteEvent:
						for _, d := range evt.Devs {
							if d.Command == "" {
								continue
							}
							dir := filepath.Join(cwd, d.Directory)
							words, _ := shellquote.Split(d.Command)
							title := d.Title
							if title == "" {
								title = d.Name
							}
							multi.AddProcess(
								d.Name,
								append([]string{currentExecutable, "dev", "--"}, words...),
								"→",
								title,
								dir,
								true,
								d.Autostart,
								append([]string{"SST_CHILD=" + d.Name}, multiEnv...)...,
							)
						}
						for name := range evt.Tunnels {
							multi.AddProcess("tunnel", []string{currentExecutable, "tunnel", "--stage", p.App().Stage}, "⇌", "Tunnel", "", true, true, append(os.Environ(),
								"SST_LOG="+p.PathLog("tunnel_"+name),
							)...)
						}
						break
					}
				}
			}
		})
	}

	wg.Go(func() error {
		defer c.Cancel()
		return deployer.Start(c.Context, p, server)
	})

	if mode == "basic" {
		wg.Go(func() error {
			return CmdUI(c)
		})
	}

	err = wg.Wait()
	slog.Info("done mosaic", "err", err)
	return err

}

func diff(a map[string]string, b map[string]string) bool {
	if len(a) != len(b) {
		return true
	}
	for k, v := range a {
		if strings.HasPrefix(k, "AWS_") {
			continue
		}
		if b[k] != v {
			return true
		}
	}
	return false
}
