package termutil

import (
	"github.com/charmbracelet/lipgloss"
)

type CellAttributes struct {
	fgColour      lipgloss.TerminalColor
	bgColour      lipgloss.TerminalColor
	bold          bool
	italic        bool
	dim           bool
	underline     bool
	strikethrough bool
	blink         bool
	inverse       bool
	hidden        bool
}
