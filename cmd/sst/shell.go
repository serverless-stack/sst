package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/sst/ion/cmd/sst/cli"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/process"
	"github.com/sst/ion/pkg/project/provider"
)

func CmdShell(c *cli.Cli) error {
	p, err := c.InitProject()
	if err != nil {
		return err
	}
	defer p.Cleanup()

	var args []string
	for _, arg := range c.Arguments() {
		args = append(args, arg)
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
	if len(args) == 0 {
		args = append(args, "sh")
	}
	cmd := process.Command(
		args[0],
		args[1:]...,
	)
	// Get the environment variables
	cmd.Env = append(cmd.Env,
		fmt.Sprintf("PS1=%s/%s> ", p.App().Name, p.App().Stage),
	)
	complete, err := p.GetCompleted(c.Context)
	if err != nil {
		return err
	}
	target := c.String("target")
	if target != "" {
		cmd.Env = append(cmd.Env, c.Env()...)
		env, err := p.EnvFor(c.Context, complete, target)
		if err != nil {
			return err
		}
		for key, value := range env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
		}
	}
	if target == "" {
		env := map[string]string{}
		for _, item := range os.Environ() {
			key, value, _ := strings.Cut(item, "=")
			env[key] = value
		}
		for resource, value := range complete.Links {
			jsonValue, err := json.Marshal(value.Properties)
			if err != nil {
				return err
			}
			env[fmt.Sprintf("SST_RESOURCE_%s", resource)] = string(jsonValue)
		}
		env["SST_RESOURCE_App"] = fmt.Sprintf(`{"name": "%s", "stage": "%s" }`, p.App().Name, p.App().Stage)

		aws, ok := p.Provider("aws")
		if ok {
			// newer versions of aws-sdk do not like it when you specify both profile and credentials
			delete(env, "AWS_PROFILE")
			provider := aws.(*provider.AwsProvider)
			cfg := provider.Config()
			creds, err := cfg.Credentials.Retrieve(c.Context)
			if err != nil {
				return err
			}
			cmd.Env = append(cmd.Env, fmt.Sprintf("AWS_ACCESS_KEY_ID=%s", creds.AccessKeyID))
			cmd.Env = append(cmd.Env, fmt.Sprintf("AWS_SECRET_ACCESS_KEY=%s", creds.SecretAccessKey))
			cmd.Env = append(cmd.Env, fmt.Sprintf("AWS_SESSION_TOKEN=%s", creds.SessionToken))
			if cfg.Region != "" {
				cmd.Env = append(cmd.Env, fmt.Sprintf("AWS_REGION=%s", cfg.Region))
			}
		}

		for key, val := range env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, val))
		}
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	err = cmd.Run()
	if err != nil {
		return util.NewReadableError(err, err.Error())
	}
	return nil
}
