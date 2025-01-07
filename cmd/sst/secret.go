package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/fatih/color"
	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/dev"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/internal/util"
	"github.com/sst/sst/v3/pkg/project/provider"
	"github.com/sst/sst/v3/pkg/server"
	"golang.org/x/sync/errgroup"
)

var CmdSecretList = &cli.Command{
	Name: "list",
	Description: cli.Description{
		Short: "List all secrets",
		Long: strings.Join([]string{
			"Lists all the secrets.",
			"",
			"Optionally, list the secrets in a specific stage.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret list --stage production",
			"```",
			"",
			"List only the fallback secrets.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret list --fallback",
			"```",
		}, "\n"),
	},
	Examples: []cli.Example{
		{
			Content: "sst secret list --stage production",
			Description: cli.Description{
				Short: "List the secrets in production",
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
		secrets := map[string]string{}
		fallback := map[string]string{}
		wg := errgroup.Group{}
		if !c.Bool("fallback") {
			wg.Go(func() error {
				secrets, err = provider.GetSecrets(backend, p.App().Name, p.App().Stage)
				if err != nil {
					return err
				}
				return nil
			})
		}
		wg.Go(func() error {
			fallback, err = provider.GetSecrets(backend, p.App().Name, "")
			if err != nil {
				return err
			}
			return nil
		})
		if err := wg.Wait(); err != nil {
			return err
		}
		if len(secrets) == 0 && len(fallback) == 0 {
			return util.NewReadableError(nil, "No secrets found")
		}
		if len(fallback) > 0 {
			color.White("# fallback")
			for key, value := range fallback {
				fmt.Println(key + "=" + value)
			}
		}
		if len(secrets) > 0 {
			color.White("# %s/%s", p.App().Name, p.App().Stage)
			for key, value := range secrets {
				fmt.Println(key + "=" + value)
			}
		}
		return nil
	},
}

var CmdSecretLoad = &cli.Command{
	Name: "load",
	Description: cli.Description{
		Short: "Set multiple secrets from file",
		Long: strings.Join([]string{
			"Load all the secrets from a file and set them.",
			"",
			"```bash frame=\"none\"",
			"sst secret load ./secrets.env",
			"```",
			"",
			"The file needs to be in the _dotenv_ or bash format of key-value pairs.",
			"",
			"```sh title=\"secrets.env\"",
			"KEY_1=VALUE1",
			"KEY_2=VALUE2",
			"```",
			"",
			"Optionally, set the secrets in a specific stage.",
			"",
			"```bash frame=\"none\"",
			"sst secret load ./prod.env --stage production",
			"```",
			"",
			"Set these secrets as _fallback_ values.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret load ./secrets.env --fallback",
			"```",
		}, "\n"),
	},
	Args: []cli.Argument{
		{
			Name:     "file",
			Required: true,
			Description: cli.Description{
				Short: "The file to load secrets from",
				Long:  "The file to load the secrets from.",
			},
		},
	},
	Examples: []cli.Example{
		{
			Content: "sst secret load ./secrets.env",
			Description: cli.Description{
				Short: "Loads all secrets from the file",
			},
		},
		{
			Content: "sst secret load ./prod.env --stage production",
			Description: cli.Description{
				Short: "Set secrets for production",
			},
		},
	},
	Run: func(c *cli.Cli) error {
		filePath := c.Positional(0)
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		defer p.Cleanup()
		backend := p.Backend()
		stage := p.App().Stage
		if c.Bool("fallback") {
			stage = ""
		}
		secrets, err := provider.GetSecrets(backend, p.App().Name, stage)
		if err != nil {
			return util.NewReadableError(err, "Could not get secrets")
		}
		file, err := os.Open(filePath)
		if err != nil {
			return util.NewReadableError(err, fmt.Sprintf("Could not open file %s", filePath))
		}
		defer file.Close()

		scanner := bufio.NewScanner(file)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				ui.Success(fmt.Sprintf("Setting %s", parts[0]))
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])
				secrets[key] = value
			}
		}
		err = provider.PutSecrets(backend, p.App().Name, stage, secrets)
		if err != nil {
			return util.NewReadableError(err, "Could not set secret")
		}
		url, _ := server.Discover(p.PathConfig(), p.App().Stage)
		if url != "" {
			dev.Deploy(c.Context, url)
			return nil
		}

		ui.Success("Run \"sst deploy\" to update.")
		return nil
	},
}

var CmdSecretSet = &cli.Command{
	Name: "set",
	Description: cli.Description{
		Short: "Set a secret",
		Long: strings.Join([]string{
			"Set the value of the secret.",
			"",
			"The secrets are encrypted and stored in an S3 Bucket in your AWS account. They are also stored in the package of the functions using the secret.",
			"",
			":::tip",
			"If you are not running `sst dev`, you'll need to `sst deploy` to apply the secret.",
			":::",
			"",
			"For example, set the `sst.Secret` called `StripeSecret` to `123456789`.",
			"",
			"```bash frame=\"none\"",
			"sst secret set StripeSecret dev_123456789",
			"```",
			"",
			"Optionally, set the secret in a specific stage.",
			"",
			"```bash frame=\"none\"",
			"sst secret set StripeSecret prod_123456789 --stage production",
			"```",
			"",
			"You can also set a _fallback_ value for a secret with `--fallback`.",
			"",
			"```bash frame=\"none\"",
			"sst secret set StripeSecret dev_123456789 --fallback",
			"```",
			"",
			"So if the secret is not set for a specific stage, it'll use the fallback instead.",
			"This only works for stages that are in the same AWS account.",
			"",
			":::tip",
			"Set fallback values for your PR stages.",
			":::",
			"",
			"This is useful for preview environments that are automatically deployed.",
			"You won't have to set the secret for the stage after it's deployed.",
			"",
			"To set something like an RSA key, you can first save it to a file.",
			"",
			"```bash frame=\"none\"",
			"cat > tmp.txt <<EOF",
			"-----BEGIN RSA PRIVATE KEY-----",
			"MEgCQQCo9+BpMRYQ/dL3DS2CyJxRF+j6ctbT3/Qp84+KeFhnii7NT7fELilKUSnx",
			"S30WAvQCCo2yU1orfgqr41mM70MBAgMBAAE=",
			"-----END RSA PRIVATE KEY-----",
			"EOF",
			"```",
			"",
			"Then set the secret from the file.",
			"",
			"```bash frame=\"none\"",
			"sst secret set Key -- \"$(cat tmp.txt)\"",
			"```",
			"",
			"And make sure to delete the temp file.",
		}, "\n"),
	},
	Args: []cli.Argument{
		{
			Name:     "name",
			Required: true,
			Description: cli.Description{
				Short: "The name of the secret",
				Long:  "The name of the secret.",
			},
		},
		{
			Name:     "value",
			Required: false,
			Description: cli.Description{
				Short: "The value of the secret",
				Long:  "The value of the secret.",
			},
		},
	},
	Examples: []cli.Example{
		{
			Content: "sst secret set StripeSecret 123456789",
			Description: cli.Description{
				Short: "Set the StripeSecret to 123456789",
			},
		},
		{
			Content: "sst secret set StripeSecret < tmp.txt",
			Description: cli.Description{
				Short: "Set the StripeSecret to contents of tmp.txt",
			},
		},
		{
			Content: "sst secret set StripeSecret productionsecret --stage production",
			Description: cli.Description{
				Short: "Set the StripeSecret in production",
			},
		},
	},
	Run: func(c *cli.Cli) error {
		key := c.Positional(0)
		value := c.Positional(1)
		if value == "" {
			stat, err := os.Stdin.Stat()
			if err != nil {
				return err
			}
			isTerminal := (stat.Mode() & os.ModeCharDevice) != 0
			if isTerminal {
				fmt.Print("Enter value: ")
			}
			reader := bufio.NewReader(os.Stdin)
			for {
				input, err := reader.ReadString('\n')
				if err != nil {
					if err == io.EOF {
						break
					}
					return err
				}
				value += input
				if isTerminal {
					value = strings.TrimRight(value, "\n")
					break
				}
			}
		}
		if !regexp.MustCompile(`^[A-Z][a-zA-Z0-9_]*$`).MatchString(key) {
			return util.NewReadableError(nil, "Secret names must start with a capital letter and contain only letters and numbers")
		}
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		defer p.Cleanup()
		stage := p.App().Stage
		if c.Bool("fallback") {
			stage = ""
		}
		backend := p.Backend()
		secrets, err := provider.GetSecrets(backend, p.App().Name, stage)
		if err != nil {
			return util.NewReadableError(err, "Could not get secrets")
		}
		secrets[key] = value
		err = provider.PutSecrets(backend, p.App().Name, stage, secrets)
		if err != nil {
			return util.NewReadableError(err, "Could not set secret")
		}
		url, _ := server.Discover(p.PathConfig(), p.App().Stage)
		suffix := " Run \"sst deploy\" to update."
		if url != "" {
			suffix = ""
			dev.Deploy(c.Context, url)
		}

		if c.Bool("fallback") {
			ui.Success(fmt.Sprintf("Set fallback value for \"%s\".%s", key, suffix))
			return nil
		}
		ui.Success(fmt.Sprintf("Set \"%s\" for stage \"%s\".%s", key, p.App().Stage, suffix))
		return nil
	},
}

var CmdSecretRemove = &cli.Command{
	Name: "remove",
	Description: cli.Description{
		Short: "Remove a secret",
		Long: strings.Join([]string{
			"Remove a secret.",
			"",
			"For example, remove the `sst.Secret` called `StripeSecret`.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret remove StripeSecret",
			"```",
			"",
			"Optionally, remove a secret in a specific stage.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret remove StripeSecret --stage production",
			"```",
			"",
			"Remove the fallback value of the secret.",
			"",
			"```bash frame=\"none\" frame=\"none\"",
			"sst secret remove StripeSecret --fallback",
			"```",
		}, "\n"),
	},
	Args: []cli.Argument{
		{
			Name:     "name",
			Required: true,
			Description: cli.Description{
				Short: "The name of the secret",
				Long:  "The name of the secret.",
			},
		},
	},
	Examples: []cli.Example{
		{
			Content: "sst secret remove StripeSecret",
			Description: cli.Description{
				Short: "Remove the StripeSecret",
			},
		},
		{
			Content: "sst secret remove StripeSecret --stage production",
			Description: cli.Description{
				Short: "Remove the StripeSecret in production",
			},
		},
	},
	Run: func(c *cli.Cli) error {
		key := c.Positional(0)
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		defer p.Cleanup()
		backend := p.Backend()
		stage := p.App().Stage
		if c.Bool("fallback") {
			stage = ""
		}
		secrets, err := provider.GetSecrets(backend, p.App().Name, stage)
		if err != nil {
			return util.NewReadableError(err, "Could not get secrets")
		}
		// check if the secret exists
		if _, ok := secrets[key]; !ok {
			return util.NewReadableError(nil, fmt.Sprintf("Secret \"%s\" does not exist", key))
		}
		delete(secrets, key)
		err = provider.PutSecrets(backend, p.App().Name, stage, secrets)
		if err != nil {
			return util.NewReadableError(err, "Could not set secret")
		}
		url, _ := server.Discover(p.PathConfig(), p.App().Stage)
		suffix := " Run \"sst deploy\" to update."
		if url != "" {
			suffix = ""
			dev.Deploy(c.Context, url)
		}
		if c.Bool("fallback") {
			ui.Success(fmt.Sprintf("Removed fallback value for \"%s\".%s", key, suffix))
			return nil
		}
		ui.Success(fmt.Sprintf("Removed \"%s\" for stage \"%s\".%s", key, p.App().Stage, suffix))
		return nil
	},
}
