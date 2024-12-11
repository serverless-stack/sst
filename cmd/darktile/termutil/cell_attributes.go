package termutil

import (
	"image/color"
)

type CellAttributes struct {
	fgColour      color.Color
	bgColour      color.Color
	bold          bool
	italic        bool
	dim           bool
	underline     bool
	strikethrough bool
	blink         bool
	inverse       bool
	hidden        bool
}
