package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/briandowns/spinner"
	"github.com/fatih/color"
	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/cmd/sst/mosaic/errors"
	"github.com/sst/ion/cmd/sst/mosaic/ui"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/flag"
	"github.com/sst/ion/pkg/global"
	"github.com/sst/ion/pkg/id"
	"github.com/sst/ion/pkg/process"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
	"github.com/sst/ion/pkg/telemetry"
)

var version = "dev"

func main() {
	// check if node_modules/.bin/sst exists
	nodeModulesBinPath := filepath.Join("node_modules", ".bin", "sst")
	binary, _ := os.Executable()
	if _, err := os.Stat(nodeModulesBinPath); err == nil && !strings.Contains(binary, "node_modules") && os.Getenv("SST_SKIP_LOCAL") != "true" && version != "dev" {
		// forward command to node_modules/.bin/sst
		fmt.Println(ui.TEXT_WARNING_BOLD.Render("Warning: ") + "You are using a global installation of SST but you also have a local installation specified in your package.json. The local installation will be used but you should typically run it through your package manager.")
		cmd := process.Command(nodeModulesBinPath, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		cmd.Env = os.Environ()
		cmd.Env = append(cmd.Env, "SST_SKIP_LOCAL=true")
		if err := cmd.Run(); err != nil {
			os.Exit(1)
		}
		return
	}
	telemetry.SetVersion(version)
	defer telemetry.Close()
	defer process.Cleanup()
	telemetry.Track("cli.start", map[string]interface{}{
		"args": os.Args[1:],
	})
	err := run()
	if err != nil {
		err := errors.Transform(err)
		errorMessage := err.Error()
		truncated := errorMessage
		if len(errorMessage) > 255 {
			truncated = errorMessage[:255]
		}
		telemetry.Track("cli.error", map[string]interface{}{
			"error": truncated,
		})
		if readableErr, ok := err.(*util.ReadableError); ok {
			slog.Error("exited with error", "err", readableErr.Unwrap())
			msg := readableErr.Error()
			if msg != "" {
				ui.Error(readableErr.Error())
				if readableErr.IsHinted() {
					fmt.Println("   " + ui.TEXT_DIM.Render(readableErr.Unwrap().Error()))
				}
			}
		} else {
			slog.Error("exited with error", "err", err)
			// check if context cancelled error
			if err != context.Canceled {
				ui.Error("Unexpected error occurred. Please run with --print-logs or check .sst/log/sst.log if available.")
			}
		}
		telemetry.Close()
		os.Exit(1)
		return
	}
	telemetry.Track("cli.success", map[string]interface{}{})
}

func run() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	interruptChannel := make(chan os.Signal, 1)
	signal.Notify(interruptChannel, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-interruptChannel
		slog.Info("interrupted")
		cancel()
	}()
	c, err := cli.New(ctx, cancel, root, version)
	if err != nil {
		return err
	}
	_, err = user.Current()
	if err != nil {
		return err
	}

	if !flag.SST_SKIP_DEPENDENCY_CHECK {
		spin := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
		spin.Suffix = "  Updating dependencies..."
		if global.NeedsPulumi() {
			spin.Start()
			err := global.InstallPulumi()
			if err != nil {
				return err
			}
		}
		if global.NeedsBun() {
			spin.Start()
			err := global.InstallBun()
			if err != nil {
				return err
			}
		}
		spin.Stop()
	}
	return c.Run()
}

var root = &cli.Command{
	Name: "sst",
	Description: cli.Description{
		Short: "deploy anything",
		Long: strings.Join([]string{
			"The CLI helps you manage your SST apps.",
			"",
			"If you are using SST as a part of your Node project, we recommend installing it locally.",
			"```bash",
			"npm install sst",
			"```",
			"---",
			"If you are not using Node, you can install the CLI globally.",
			"```bash",
			"curl -fsSL https://sst.dev/install | bash",
			"```",
			"",
			":::note",
			"The CLI currently supports macOS, Linux, and WSL. Windows support is coming soon.",
			":::",
			"",
			"To install a specific version.",
			"",
			"```bash \"VERSION=0.0.403\"",
			"curl -fsSL https://sst.dev/install | VERSION=0.0.403 bash",
			"```",
			"---",
			"#### With a package manager",
			"",
			"You can also use a package manager to install the CLI.",
			"",
			"- **macOS**",
			"",
			"  The CLI is available via a Homebrew Tap, and as downloadable binary in the [releases](https://github.com/sst/ion/releases/latest).",
			"",
			"  ```bash",
			"  brew install sst/tap/sst",
			"",
			"  # Upgrade",
			"  brew upgrade sst",
			"  ```",
			"",
			"  You might have to run `brew upgrade sst`, before the update.",
			"",
			"- **Linux**",
			"",
			"  The CLI is available as downloadable binaries in the [releases](https://github.com/sst/ion/releases/latest). Download the `.deb` or `.rpm` and install with `sudo dpkg -i` and `sudo rpm -i`.",
			"",
			"  For Arch Linux, it's available in the [aur](https://aur.archlinux.org/packages/sst-bin).",
			"---",
			"#### Usage",
			"",
			"Once installed you can run the commands using.",
			"",
			"```bash",
			"sst [command]",
			"```",
			"",
			"The CLI takes a few global flags. For example, the deploy command takes the `--stage` flag",
			"",
			"```bash",
			"sst deploy --stage production",
			"```",
			"---",
			"#### Environment variables",
			"",
			"You can access any environment variables set in the CLI in your `sst.config.ts` file. For example, running:",
			"",
			"```bash",
			"ENV_VAR=123 sst deploy",
			"```",
			"",
			"Will let you access `ENV_VAR` through `process.env.ENV_VAR`.",
		}, "\n"),
	},
	Flags: []cli.Flag{
		{
			Name: "stage",
			Type: "string",
			Description: cli.Description{
				Short: "The stage to deploy to",
				Long: strings.Join([]string{
					"Set the stage the CLI is running on.",
					"",
					"```bash frame=\"none\"",
					"sst [command] --stage production",
					"```",
					"",
					"The stage is a string that is used to prefix the resources in your app. This allows you to have multiple _environments_ of your app running in the same account.",
					"",
					":::tip",
					"Changing the stage will redeploy your app to a new stage with new resources. The old resources will still be around in the old stage.",
					":::",
					"",
					"You can also use the `SST_STAGE` environment variable.",
					"```bash frame=\"none\"",
					"SST_STAGE=dev sst [command]",
					"```",
					"This can also be declared in a `.env` file or in the CLI session.",
					"",
					"If the stage is not passed in, then the CLI will:",
					"",
					"1. Use the username on the local machine.",
					"   - If the username is `root`, `admin`, `prod`, `dev`, `production`, then it will prompt for a stage name.",
					"2. Store this in the `.sst/stage` file and reads from it in the future.",
					"",
					"This stored stage is called your **personal stage**.",
				}, "\n"),
			},
		},
		{
			Name: "verbose",
			Type: "bool",
			Description: cli.Description{
				Short: "Enable verbose logging",
				Long: strings.Join([]string{
					"",
					"Prints extra information to the log files in the `.sst/` directory.",
					"",
					"```bash",
					"sst [command] --verbose",
					"```",
					"",
					"To also view this on the screen, use the `--print-logs` flag.",
					"",
				}, "\n"),
			},
		},
		{
			Name: "print-logs",
			Type: "bool",
			Description: cli.Description{
				Short: "Print logs to stderr",
				Long: strings.Join([]string{
					"",
					"Print the logs to the screen. These are logs that are written to the `.sst/` directory.",
					"",
					"```bash",
					"sst [command] --print-logs",
					"```",
					"It can also be set using the `SST_PRINT_LOGS` environment variable.",
					"",
					"```bash",
					"SST_PRINT_LOGS=1 sst [command]",
					"```",
					"This is useful when running in a CI environment.",
					"",
				}, "\n"),
			},
		},
		{
			Name: "help",
			Type: "bool",
			Description: cli.Description{
				Short: "Print help",
				Long: strings.Join([]string{
					"Prints help for the given command.",
					"",
					"```sh frame=\"none\"",
					"sst [command] --help",
					"```",
					"",
					"Or the global help.",
					"",
					"```sh frame=\"none\"",
					"sst --help",
					"```",
				}, "\n"),
			},
		},
	},
	Children: []*cli.Command{
		{
			Name: "init",
			Description: cli.Description{
				Short: "Initialize a new project",
				Long: strings.Join([]string{
					"Initialize a new project in the current directory. This will create a `sst.config.ts` and `sst install` your providers.",
					"",
					"If this is run in a Next.js, Remix, Astro, or SvelteKit project, it'll init SST in drop-in mode.",
					"",
					"To skip the interactive confirmation after detecting the framework.",
					"",
					"```bash frame=\"none\"",
					"sst init --yes",
					"```",
				}, "\n"),
			},
			Run: CmdInit,
			Flags: []cli.Flag{
				{
					Name: "yes",
					Type: "bool",
					Description: cli.Description{
						Short: "Skip interactive confirmation",
						Long:  "Skip interactive confirmation for detected framework.",
					},
				},
			},
		},
		{
			Name:   "ui",
			Hidden: true,
			Run:    CmdUI,
			Flags: []cli.Flag{
				{
					Name: "filter",
					Type: "string",
					Description: cli.Description{
						Short: "Filter events",
						Long:  "Filter events.",
					},
				},
			},
		},
		{
			Name: "dev",
			Description: cli.Description{
				Short: "Run in development mode",
				Long: strings.Join([]string{
					"Run your app in dev mode.",
					"",
					"```bash frame=\"none\"",
					"sst dev",
					"```",
					"By default, this starts a multiplexer with processes that deploy your app, run your functions, and start your frontend.",
					"",
					"![sst dev multiplexer mode](../../../../assets/docs/cli/sst-dev-multiplexer-mode.png)",
					"",
					"Each process is run in a separate pane that you can click on in the sidebar. These",
					"include processes that:",
					"",
					"1. Watch your `sst.config.ts` and deploy your app",
					"2. Run your functions [Live](/docs/live/) and logs their invocations",
					"3. Start a [`sst tunnel`](#tunnel) session if your app has a VPC with `bastion` enabled",
					"4. Run the dev mode for components that have `dev.autostart` enabled",
					"   - Components like `Service` and frontends like `Nextjs`, `Remix`, `Astro`, `StaticSite`, etc.",
					"   - It starts their `dev.command` in a separate pane",
					"   - And loads any [linked resources](/docs/linking) in the environment",
					"",
					"The multiplexer makes it so that you won't have to start your frontend or",
					"your container applications separately.",
					"",
					":::tip",
					"The `sst dev` CLI also starts your frontend. So you don't need to start it",
					"separately.",
					":::",
					"",
					"While `sst dev` does a deploy when it starts up, it does not deploy components like",
					"`Service`, or the frontends like `Nextjs`, `Remix`, `Astro`, `StaticSite`, etc.",
					"That's because these have their own dev modes that the multiplexer starts.",
					"",
					":::note",
					"The `Service` component and the frontends like `Nextjs` or `StaticSite` are not",
					"deployed by `sst dev`.",
					":::",
					"",
					"Optionally, you can disable the multiplexer and run `sst dev` in basic mode.",
					"",
					"```bash frame=\"none\"",
					"sst dev --mode=basic",
					"```",
					"",
					"This will only deploy your app and run your functions. If you are coming from SST",
					"v2, this is how `sst dev` used to work.",
					"",
					"However in `basic` mode, you'll need to start your frontend separately by running",
					"`sst dev` in a separate terminal session by passing in the command. For example:",
					"",
					"```bash frame=\"none\"",
					"sst dev next dev",
					"```",
					"",
					"By wrapping your command, it'll load your [linked resources](/docs/linking) in the",
					"environment.",
					"",
					"To pass in a flag to the command, use `--`.",
					"",
					"```bash frame=\"none\"",
					"sst dev -- next dev --turbo",
					"```",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "mode",
					Type: "string",
					Description: cli.Description{
						Short: "Use mode=basic to turn off multiplexer",
						Long:  "Defaults to using the multiplexer or `mosaic` mode. Use `basic` to turn it off.",
					},
				},
			},
			Args: []cli.Argument{
				{
					Name: "command",
					Description: cli.Description{
						Short: "The command to run",
					},
				},
			},
			Examples: []cli.Example{
				{
					Content: "sst dev",
					Description: cli.Description{
						Short: "Brings up your entire app - should be all you need",
					},
				},
				{
					Content: "sst dev next dev",
					Description: cli.Description{
						Short: "Start a command connected to a running sst dev session",
					},
				},
				{
					Content: "sst dev -- next dev --turbo",
					Description: cli.Description{
						Short: "Use -- to pass flags to the command",
					},
				},
			},
			Run: CmdMosaic,
		},
		{
			Name: "deploy",
			Description: cli.Description{
				Short: "Deploy your application",
				Long: strings.Join([]string{
					"Deploy your application. By default, it deploys to your personal stage.",
					"",
					"All the resources are deployed as concurrently as possible, based on their dependencies.",
					"For resources like your sites and functions; it first builds them and then deploys the generated assets.",
					"",
					"Since the build processes for some of these resources, like Next.js, take a lot of memory, the concurrency is limited by default of 4.",
					"You can change this by setting the `SST_BUILD_CONCURRENCY` environment variable.",
					"",
					"```bash frame=\"none\"",
					"SST_BUILD_CONCURRENCY=8 sst deploy",
					"```",
					"",
					"You can change this based on how much memory your CI environment has.",
					"",
					":::tip",
					"You can turn down the build concurrency if you are running out of memory in CI.",
					":::",
					"",
					"Optionally, deploy your app to a specific stage.",
					"",
					"```bash frame=\"none\"",
					"sst deploy --stage production",
					"```",
					"Optionally, deploy specific resources by passing in a list of their URNs.",
					"You can get the URN of a resource from the [Console](/docs/console/#resources).",
					"",
					"```bash frame=\"none\"",
					"sst deploy --target urn:pulumi:prod::www::sst:aws:Astro::Astro,urn:pulumi:prod::www::sst:aws:Bucket::Assets",
					"```",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "target",
					Description: cli.Description{
						Short: "Comma separated list of target URNs",
						Long:  "Comma separated list of target URNs.",
					},
				},
			},
			Examples: []cli.Example{
				{
					Content: "sst deploy --stage production",
					Description: cli.Description{
						Short: "Deploy to production",
					},
				},
			},
			Run: CmdDeploy,
		},
		{
			Name: "diff",
			Description: cli.Description{
				Short: "See what changes will be made",
				Long: strings.Join([]string{
					"Builds your app to see what changes will be made when you deploy it.",
					"",
					"It displays a list of resources that will be created, updated, or deleted.",
					"For each of these resources, it'll also show the properties that are changing.",
					"",
					":::tip",
					"Run a `sst diff` to see what changes will be made when you deploy your app.",
					":::",
					"",
					"This is useful for cases when you pull some changes from a teammate and want to",
					"see what will be deployed; before doing the actual deploy.",
					"",
					"Optionally, you can diff a specific set of resources by passing in a list of their URNs.",
					"",
					"```bash frame=\"none\"",
					"sst diff --target urn:pulumi:prod::www::sst:aws:Astro::Astro,urn:pulumi:prod::www::sst:aws:Bucket::Assets",
					"```",
					"",
					"By default, this compares to the last deploy of the given stage as it would be",
					"deployed using `sst deploy`. But if you are working in dev mode using `sst dev`,",
					"you can use the `--dev` flag.",
					"",
					"```bash frame=\"none\"",
					"sst diff --dev",
					"```",
					"",
					"This is useful because in dev mode, you app is deployed a little differently.",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "target",
					Description: cli.Description{
						Short: "Comma separated list of target URNs",
						Long:  "Comma separated list of target URNs.",
					},
				},
				{
					Name: "dev",
					Type: "bool",
					Description: cli.Description{
						Short: "Compare to sst dev",
						Long: strings.Join([]string{
							"Compare to the dev of this stage.",
						}, "\n"),
					},
				},
			},
			Examples: []cli.Example{
				{
					Content: "sst diff --stage production",
					Description: cli.Description{
						Short: "See changes to production",
					},
				},
			},
			Run: CmdDiff,
		},
		{
			Name: "add",
			Description: cli.Description{
				Short: "Add a new provider",
				Long: strings.Join([]string{
					"Adds and installs the given provider. For example,",
					"",
					"```bash frame=\"none\"",
					"sst add aws",
					"```",
					"",
					"This command will:",
					"",
					"1. Installs the package for the AWS provider.",
					"2. Add `aws` to the globals in your `sst.config.ts`.",
					"3. And, add it to your `providers`.",
					"",
					"```ts title=\"sst.config.ts\"",
					"{",
					"  providers: {",
					"    aws: \"6.27.0\"",
					"  }",
					"}",
					"```",
					"",
					"You can use any provider listed in the [Directory](/docs/providers#directory).",
					"",
					":::note",
					"Running `sst add aws` above is the same as manually adding the provider to your config and running `sst install`.",
					":::",
					"",
					"By default, the latest version of the provider is installed. If you want to use a specific version, you can change it in your config.",
					"",
					"```ts title=\"sst.config.ts\"",
					"{",
					"  providers: {",
					"    aws: {",
					"      version: \"6.26.0\"",
					"    }",
					"  }",
					"}",
					"```",
					"",
					"You'll need to run `sst install` if you update the `providers` in your config.",
					"",
					"By default, these packages are fetched from the NPM registry. If you want to use a different registry, you can set the `NPM_REGISTRY` environment variable.",
					"",
					"```bash frame=\"none\"",
					"NPM_REGISTRY=https://my-registry.com sst add aws",
					"```",
				}, "\n"),
			},
			Args: []cli.Argument{
				{
					Name:     "provider",
					Required: true,
					Description: cli.Description{
						Short: "The provider to add",
						Long:  "The provider to add.",
					},
				},
			},
			Run: func(cli *cli.Cli) error {
				pkg := cli.Positional(0)
				spin := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
				spin.Suffix = "  Adding provider..."
				spin.Start()
				defer spin.Stop()
				cfgPath, err := project.Discover()
				if err != nil {
					return err
				}
				stage, err := cli.Stage(cfgPath)
				if err != nil {
					return err
				}
				p, err := project.New(&project.ProjectConfig{
					Version: version,
					Config:  cfgPath,
					Stage:   stage,
				})
				if err != nil {
					return err
				}
				if !p.CheckPlatform(version) {
					err := p.CopyPlatform(version)
					if err != nil {
						return err
					}
				}
				entry, err := project.FindProvider(pkg, "latest")
				if err != nil {
					return util.NewReadableError(err, "Could not find provider "+pkg)
				}
				err = p.Add(entry.Name, entry.Version)
				if err != nil {
					return err
				}
				spin.Suffix = "  Downloading provider..."
				p, err = project.New(&project.ProjectConfig{
					Version: version,
					Config:  cfgPath,
					Stage:   stage,
				})
				if err != nil {
					return err
				}
				err = p.Install()
				if err != nil {
					return err
				}
				spin.Stop()
				ui.Success(fmt.Sprintf("Added provider \"%s\". You can create resources with `new %s.SomeResource()`", entry.Alias, entry.Alias))
				return nil
			},
		},
		{
			Name: "install",
			Description: cli.Description{
				Short: "Install all the providers",
				Long: strings.Join([]string{
					"Installs the providers in your `sst.config.ts`. You'll need this command when:",
					"",
					"1. You add a new provider to the `providers` or `home` in your config.",
					"2. Or, when you want to install new providers after you `git pull` some changes.",
					"",
					":::tip",
					"The `sst install` command is similar to `npm install`.",
					":::",
					"",
					"Behind the scenes, it installs the packages for your providers and adds the providers to your globals.",
					"",
					"If you don't have a version specified for your providers in your `sst.config.ts`, it'll install their latest versions.",
				}, "\n"),
			},
			Run: func(cli *cli.Cli) error {
				cfgPath, err := project.Discover()
				if err != nil {
					return err
				}

				stage, err := cli.Stage(cfgPath)
				if err != nil {
					return err
				}

				p, err := project.New(&project.ProjectConfig{
					Version: version,
					Config:  cfgPath,
					Stage:   stage,
				})
				if err != nil {
					return err
				}

				spin := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
				defer spin.Stop()
				spin.Suffix = "  Installing providers..."
				spin.Start()
				if !p.CheckPlatform(version) {
					err := p.CopyPlatform(version)
					if err != nil {
						return err
					}
				}

				err = p.Install()
				if err != nil {
					return err
				}
				spin.Stop()
				ui.Success("Installed providers")
				return nil
			},
		},
		{
			Name: "secret",
			Description: cli.Description{
				Short: "Manage secrets",
				Long: strings.Join([]string{
					"Manage the secrets in your app defined with `sst.Secret`.",
					"",
					"The `--fallback` flag can be used to manage the fallback values of a secret.",
					"Applies to all the sub-commands in `sst secret`.",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "fallback",
					Type: "bool",
					Description: cli.Description{
						Short: "Manage the fallback values of secrets",
						Long:  "Manage the fallback values of secrets.",
					},
				},
			},
			Children: []*cli.Command{
				CmdSecretSet,
				CmdSecretRemove,
				CmdSecretLoad,
				CmdSecretList,
			},
		},
		{
			Name: "shell",
			Args: []cli.Argument{
				{
					Name: "command",
					Description: cli.Description{
						Short: "A command to run",
						Long:  "A command to run.",
					},
				},
			},
			Flags: []cli.Flag{
				{
					Name: "target",
					Description: cli.Description{
						Short: "Target to run against",
						Long:  "Target to run against.",
					},
				},
			},
			Description: cli.Description{
				Short: "Run a command with linked resources",
				Long: strings.Join([]string{
					"Run a command with **all the resources linked** to the environment. This is useful for running scripts against your infrastructure.",
					"",
					"For example, let's say you have the following resources in your app.",
					"",
					"```js title=\"sst.config.ts\" {5,9}",
					"new sst.aws.Bucket(\"MyMainBucket\");",
					"new sst.aws.Bucket(\"MyAdminBucket\");",
					"```",
					"",
					"We can now write a script that'll can access both these resources with the [JS SDK](/docs/reference/sdk/).",
					"",
					"```js title=\"my-script.js\" \"Resource.MyMainBucket.name\" \"Resource.MyAdminBucket.name\"",
					"import { Resource } from \"sst\";",
					"",
					"console.log(Resource.MyMainBucket.name, Resource.MyAdminBucket.name);",
					"```",
					"",
					"And run the script with `sst shell`.",
					"",
					"```bash frame=\"none\" frame=\"none\"",
					"sst shell node my-script.js",
					"```",
					"",
					"This'll have access to all the buckets from above.",
					"",
					":::tip",
					"Run the command with `--` to pass arguments to it.",
					":::",
					"",
					"To pass arguments into the script, you'll need to prefix it using `--`.",
					"",
					"```bash frame=\"none\" frame=\"none\" /--(?!a)/",
					"sst shell -- node my-script.js --arg1 --arg2",
					"```",
					"",
					"If no command is passed in, it opens a shell session with the linked resources.",
					"",
					"```bash frame=\"none\" frame=\"none\"",
					"sst shell",
					"```",
					"",
					"This is useful if you want to run multiple commands, all while accessing the resources in your app.",
				}, "\n"),
			},
			Examples: []cli.Example{
				{
					Content: "sst shell",
					Description: cli.Description{
						Short: "Open a shell session",
					},
				},
			},
			Run: CmdShell,
		},
		{
			Name: "remove",
			Description: cli.Description{
				Short: "Remove your application",
				Long: strings.Join([]string{
					"Removes your application. By default, it removes your personal stage.",
					"",
					":::tip",
					"The resources in your app are removed based on the `removal` setting in your `sst.config.ts`.",
					":::",
					"",
					"This does not remove the SST _state_ and _bootstrap_ resources in your account as these might still be in use by other apps. You can remove them manually if you want to reset your account, [learn more](docs/providers/#state).",
					"",
					"Optionally, remove your app from a specific stage.",
					"",
					"```bash frame=\"none\" frame=\"none\"",
					"sst remove --stage production",
					"```",
					"Optionally, remove specific resources by passing in a list of their URNs.",
					"You can get the URN of a resource from the [Console](/docs/console/#resources).",
					"",
					"```bash frame=\"none\"",
					"sst remove --target urn:pulumi:prod::www::sst:aws:Astro::Astro,urn:pulumi:prod::www::sst:aws:Bucket::Assets",
					"```",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "target",
					Type: "string",
					Description: cli.Description{
						Short: "Comma separated list of target URNs",
						Long:  "Comma separated list of target URNs.",
					},
				},
			},
			Run: CmdRemove,
		},
		{
			Name: "unlock",
			Description: cli.Description{
				Short: "Clear any locks on the app state",
				Long: strings.Join([]string{
					"When you run `sst deploy`, it acquires a lock on your state file to prevent concurrent deploys.",
					"",
					"However, if something unexpectedly kills the `sst deploy` process, or if you manage to run `sst deploy` concurrently, the lock might not be released.",
					"",
					"This should not usually happen, but it can prevent you from deploying. You can run `sst unlock` to release the lock.",
				}, "\n"),
			},
			Run: func(c *cli.Cli) error {
				p, err := c.InitProject()
				if err != nil {
					return err
				}
				defer p.Cleanup()

				err = p.Cancel()
				if err != nil {
					return err
				}
				color.New(color.FgGreen, color.Bold).Print("✓ ")
				color.New(color.FgWhite).Print(" Unlocked the app state for: ")
				color.New(color.FgWhite, color.Bold).Println(p.App().Name, "/", p.App().Stage)
				return nil
			},
		},
		CmdVersion,
		{
			Name: "upgrade",
			Description: cli.Description{
				Short: "Upgrade the CLI",
				Long: strings.Join([]string{
					"Upgrade the CLI to the latest version. Or optionally, pass in a version to upgrade to.",
					"",
					"```bash frame=\"none\"",
					"sst upgrade 0.10",
					"```",
				}, "\n"),
			},
			Args: cli.ArgumentList{
				{
					Name: "version",
					Description: cli.Description{
						Short: "A version to upgrade to",
						Long:  "A version to upgrade to.",
					},
				},
			},
			Run: CmdUpgrade,
		},
		{
			Name: "telemetry", Description: cli.Description{
				Short: "Manage telemetry settings",
				Long: strings.Join([]string{
					"Manage telemetry settings.",
					"",
					"SST collects completely anonymous telemetry data about general usage. We track:",
					"- Version of SST in use",
					"- Command invoked, `sst dev`, `sst deploy`, etc.",
					"- General machine information, like the number of CPUs, OS, CI/CD environment, etc.",
					"",
					"This is completely optional and can be disabled at any time.",
					"",
					"You can also opt-out by setting an environment variable: `SST_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.",
				}, "\n"),
			},
			Children: []*cli.Command{
				{
					Name: "enable",
					Description: cli.Description{
						Short: "Enable telemetry",
						Long:  "Enable telemetry.",
					},
					Run: func(cli *cli.Cli) error {
						return telemetry.Enable()
					},
				},
				{
					Name: "disable",
					Description: cli.Description{
						Short: "Disable telemetry",
						Long:  "Disable telemetry.",
					},
					Run: func(cli *cli.Cli) error {
						return telemetry.Disable()
					},
				},
			},
		},
		{
			Name:   "introspect",
			Hidden: true,
			Run: func(cli *cli.Cli) error {
				data, err := json.MarshalIndent(cli.Path()[0], "", "  ")
				if err != nil {
					return err
				}
				fmt.Println(string(data))
				return nil
			},
		},
		{
			Name:   "common-errors",
			Hidden: true,
			Run: func(cli *cli.Cli) error {
				data, err := json.MarshalIndent(project.CommonErrors, "", "  ")
				if err != nil {
					return err
				}
				fmt.Println(string(data))
				return nil
			},
		},
		{
			Name: "refresh",
			Description: cli.Description{
				Short: "Refresh the local app state",
				Long: strings.Join([]string{
					"Compares your local state with the state of the resources in the cloud provider. Any changes that are found are adopted into your local state. It will:",
					"",
					"1. Go through every single resource in your state.",
					"2. Make a call to the cloud provider to check the resource.",
					"   - If the configs are different, it'll **update the state** to reflect the change.",
					"   - If the resource doesn't exist anymore, it'll **remove it from the state**.",
					"",
					":::note",
					"The `sst refresh` does not make changes to the resources in the cloud provider.",
					":::",
					"Optionally, refresh specific resources by passing in a list of their URNs.",
					"You can get the URN of a resource from the [Console](/docs/console/#resources).",
					"",
					"```bash frame=\"none\"",
					"sst refresh --target urn:pulumi:prod::www::sst:aws:Astro::Astro,urn:pulumi:prod::www::sst:aws:Bucket::Assets",
					"```",
					"",
					"This is useful for cases where you want to ensure that your local state is in sync with your cloud provider. [Learn more about how state works](/docs/providers/#how-state-works).",
				}, "\n"),
			},
			Flags: []cli.Flag{
				{
					Name: "target",
					Type: "string",
					Description: cli.Description{
						Short: "Comma separated list of target URNs",
						Long:  "Comma separated list of target URNs.",
					},
				},
			},
			Run: CmdRefresh,
		},
		{
			Name:   "state",
			Hidden: true,
			Description: cli.Description{
				Short: "Manage state of your deployment",
			},
			Children: []*cli.Command{
				{
					Name: "edit",
					Description: cli.Description{
						Short: "Edit the state of your deployment",
					},
					Run: func(c *cli.Cli) error {
						p, err := c.InitProject()
						if err != nil {
							return err
						}
						defer p.Cleanup()

						var parsed provider.Summary
						parsed.Version = version
						parsed.UpdateID = id.Descending()
						parsed.TimeStarted = time.Now().UTC().Format(time.RFC3339)
						err = p.Lock(parsed.UpdateID, "edit")
						if err != nil {
							return util.NewReadableError(err, "Could not lock state")
						}
						defer p.Unlock()
						defer func() {
							parsed.TimeCompleted = time.Now().UTC().Format(time.RFC3339)
							provider.PutSummary(p.Backend(), p.App().Name, p.App().Stage, parsed.UpdateID, parsed)
						}()

						path, err := p.PullState()
						if err != nil {
							return util.NewReadableError(err, "Could not pull state")
						}
						editor := os.Getenv("EDITOR")
						if editor == "" {
							editor = "vim"
						}
						editorArgs := append(strings.Fields(editor), path)
						fmt.Println(editorArgs)
						cmd := process.Command(editorArgs[0], editorArgs[1:]...)
						cmd.Stdin = os.Stdin
						cmd.Stdout = os.Stdout
						cmd.Stderr = os.Stderr
						if err := cmd.Start(); err != nil {
							return util.NewReadableError(err, "Could not start editor")
						}
						if err := cmd.Wait(); err != nil {
							return util.NewReadableError(err, "Editor exited with error")
						}

						return p.PushState(parsed.UpdateID)
					},
				},
			},
		},
		CmdCert,
		CmdTunnel,
		CmdDiagnostic,
	},
}
