package cli

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"runtime/debug"
	"time"

	"github.com/briandowns/spinner"
	"github.com/joho/godotenv"
	"github.com/sst/ion/internal/util"
	"github.com/sst/ion/pkg/flag"
	"github.com/sst/ion/pkg/project"
)

var logFile = (func() *os.File {
	tmpPath := flag.SST_LOG
	if tmpPath == "" {
		tmpPath = filepath.Join(os.TempDir(), "sst-"+time.Now().Format("2006-01-02-15-04-05-*")+".log")
	}
	logFile, err := os.Create(tmpPath)
	if err != nil {
		panic(err)
	}
	return logFile
})()

func (c *Cli) InitProject() (*project.Project, error) {
	slog.Info("initializing project", "version", c.version)

	cfgPath, err := project.Discover()
	if err != nil {
		return nil, util.NewReadableError(err, "Could not find sst.config.ts")
	}

	stage, err := c.Stage(cfgPath)
	if err != nil {
		return nil, util.NewReadableError(err, "Could not find stage")
	}

	p, err := project.New(&project.ProjectConfig{
		Version: c.version,
		Stage:   stage,
		Config:  cfgPath,
	})
	if err != nil {
		return nil, err
	}
	godotenv.Load(filepath.Join(p.PathRoot(), ".env"))

	if flag.SST_LOG == "" {
		_, err = logFile.Seek(0, 0)
		if err != nil {
			return nil, err
		}
		sstLog := p.PathLog("sst")
		logPath := p.PathLog("")
		os.RemoveAll(logPath)
		os.MkdirAll(logPath, 0755)
		nextLogFile, err := os.Create(sstLog)
		if err != nil {
			return nil, util.NewReadableError(err, "Could not create log file")
		}
		_, err = io.Copy(nextLogFile, logFile)
		if err != nil {
			return nil, util.NewReadableError(err, "Could not copy log file")
		}
		logFile.Close()
		err = os.RemoveAll(filepath.Join(os.TempDir(), logFile.Name()))
		if err != nil {
			return nil, err
		}
		logFile = nextLogFile
	}
	c.configureLog()

	spin := spinner.New(spinner.CharSets[14], 100*time.Millisecond)
	defer spin.Stop()
	if !p.CheckPlatform(c.version) {
		spin.Suffix = "  Upgrading project..."
		spin.Start()
		err := p.CopyPlatform(c.version)
		if err != nil {
			return nil, util.NewReadableError(err, "Could not copy platform code to project directory")
		}
	}

	if p.NeedsInstall() {
		spin.Suffix = "  Installing providers..."
		spin.Start()
		err = p.Install()
		if err != nil {
			return nil, err
		}
	}

	if err := p.LoadHome(); err != nil {
		return nil, err
	}

	app := p.App()
	slog.Info("loaded config", "app", app.Name, "stage", app.Stage)

	c.configureLog()
	return p, nil
}

func (c *Cli) configureLog() {
	writers := []io.Writer{logFile}
	if c.Bool("print-logs") || flag.SST_PRINT_LOGS {
		writers = append(writers, os.Stderr)
	}
	writer := io.MultiWriter(writers...)
	slog.SetDefault(
		slog.New(slog.NewTextHandler(writer, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		})),
	)
	debug.SetCrashOutput(logFile, debug.CrashOptions{})
}
