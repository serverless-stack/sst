package termutil

import (
	"os"
)

type Option func(t *Terminal)

func WithLogFile(path string) Option {
	return func(t *Terminal) {
		if path == "-" {
			t.logFile = os.Stdout
			return
		}
		t.logFile, _ = os.Create(path)
	}
}

func WithTheme(theme *Theme) Option {
	return func(t *Terminal) {
		t.theme = theme
	}
}

func WithShell(shell string) Option {
	return func(t *Terminal) {
		t.shell = shell
	}
}

func WithInitialCommand(cmd string) Option {
	return func(t *Terminal) {
		t.initialCommand = cmd + "\n"
	}
}

func WithWindowManipulator(m WindowManipulator) Option {
	return func(t *Terminal) {
		t.windowManipulator = m
	}
}
