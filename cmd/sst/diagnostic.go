package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/sst/sst/v3/cmd/sst/cli"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"github.com/sst/sst/v3/pkg/project"
)

var CmdDiagnostic = &cli.Command{
	Name: "diagnostic",
	Description: cli.Description{
		Short: "Generates a diagnostic report",
		Long: strings.Join([]string{
			"Generates a diagnostic report based on the last command that was run.",
			"",
			"This takes the state of your app, its log files, and generates a zip file in the `.sst/` directory. This is for debugging purposes.",
		}, "\n"),
	},
	Run: func(c *cli.Cli) error {
		cfg, err := project.Discover()
		if err != nil {
			return err
		}
		workingDir := project.ResolveWorkingDir(cfg)
		logDir := project.ResolveLogDir(cfg)
		logFiles, err := os.ReadDir(logDir)
		fmt.Println(ui.TEXT_DIM.Render("Generating diagnostic report from last run..."))
		zipFile, err := os.Create(filepath.Join(workingDir, "report.zip"))
		if err != nil {
			return err
		}
		defer zipFile.Close()
		archive := zip.NewWriter(zipFile)
		defer archive.Close()

		addFile := func(path string, name string) error {
			fmt.Println(ui.TEXT_DIM.Render("-  " + name))
			fileToZip, err := os.Open(path)
			if err != nil {
				return err
			}
			defer fileToZip.Close()
			info, err := fileToZip.Stat()
			if err != nil {
				return err
			}
			header, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			header.Name = name
			header.Method = zip.Deflate
			writer, err := archive.CreateHeader(header)
			if err != nil {
				return err
			}
			_, err = io.Copy(writer, fileToZip)
			if err != nil {
				return err
			}
			return nil
		}

		if err != nil {
			return err
		}
		for _, file := range logFiles {
			if !file.IsDir() {
				filePath := filepath.Join(logDir, file.Name())
				err := addFile(filePath, file.Name())
				if err != nil {
					return err
				}
			}
		}
		p, err := c.InitProject()
		if err != nil {
			return err
		}
		workdir, err := p.NewWorkdir()
		if err != nil {
			return err
		}
		statePath, err := workdir.Pull()
		if err != nil {
			return err
		}
		defer workdir.Cleanup()
		err = addFile(statePath, "state.json")
		if err != nil {
			return err
		}
		fmt.Println()
		ui.Success("Report generated: " + zipFile.Name())
		return nil
	},
}
