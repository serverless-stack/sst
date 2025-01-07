package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/process"
)

var CmdCert = &cli.Command{
	Name: "cert",
	Description: cli.Description{
		Short: "Generate certificate for the Console",
		Long: strings.Join([]string{
			"Generate a locally-trusted certificate to connect to the Console.",
			"",
			"The Console can show you local logs from `sst dev` by connecting to your  CLI. Certain browsers like Safari and Brave require the local connection  to be running on HTTPS.",
			"",
			"This command uses [mkcert](https://github.com/FiloSottile/mkcert) internally to generate a locally-trusted certificate for `localhost` and `127.0.0.1`.",
			"",
			"You'll only need to do this once on your machine.",
		}, "\n"),
	},
	Run: func(c *cli.Cli) error {
		err := global.EnsureMkcert()
		if err != nil {
			return err
		}
		env := os.Environ()
		env = append(env, "CAROOT="+global.CertPath())
		cmd := process.Command("mkcert", "-install")
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		err = cmd.Run()
		if err != nil {
			return err
		}
		cmd = process.Command(
			"mkcert",
			"-key-file", filepath.Join(global.CertPath(), "key.pem"),
			"-cert-file", filepath.Join(global.CertPath(), "cert.pem"),
			"127.0.0.1",
			"localhost",
		)
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Stdin = os.Stdin
		err = cmd.Run()
		if err != nil {
			return err
		}
		return nil
	},
}
