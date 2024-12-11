package termutil

import (
	"github.com/sst/ion/cmd/darktile/sixel"
	"image"
	"math"
	"strings"
)

type Sixel struct {
	X      uint16
	Y      uint64 // raw line
	Width  uint64
	Height uint64
	Image  image.Image
}

type VisibleSixel struct {
	ViewLineOffset int
	Sixel          Sixel
}

func (b *Buffer) addSixel(img image.Image, widthCells int, heightCells int) {
	b.sixels = append(b.sixels, Sixel{
		X:      b.CursorColumn(),
		Y:      b.cursorPosition.Line,
		Width:  uint64(widthCells),
		Height: uint64(heightCells),
		Image:  img,
	})
	if b.modes.SixelScrolling {
		b.cursorPosition.Line += uint64(heightCells)
	}
}

func (b *Buffer) clearSixelsAtRawLine(rawLine uint64) {
	var filtered []Sixel

	for _, sixelImage := range b.sixels {
		if sixelImage.Y+sixelImage.Height-1 >= rawLine && sixelImage.Y <= rawLine {
			continue
		}

		filtered = append(filtered, sixelImage)
	}

	b.sixels = filtered
}

func (b *Buffer) GetVisibleSixels() []VisibleSixel {

	firstLine := b.convertViewLineToRawLine(0)
	lastLine := b.convertViewLineToRawLine(b.viewHeight - 1)

	var visible []VisibleSixel

	for _, sixelImage := range b.sixels {
		if sixelImage.Y+sixelImage.Height-1 < firstLine {
			continue
		}
		if sixelImage.Y > lastLine {
			continue
		}

		visible = append(visible, VisibleSixel{
			ViewLineOffset: int(sixelImage.Y) - int(firstLine),
			Sixel:          sixelImage,
		})
	}

	return visible
}

func (t *Terminal) handleSixel(readChan chan MeasuredRune) (renderRequired bool) {

	var data []rune

	var inEscape bool

	for {
		r := <-readChan

		switch r.Rune {
		case 0x1b:
			inEscape = true
			continue
		case 0x5c:
			if inEscape {
				img, err := sixel.Decode(strings.NewReader(string(data)), t.theme.DefaultBackground())
				if err != nil {
					return false
				}
				w, h := t.windowManipulator.CellSizeInPixels()
				cw := int(math.Ceil(float64(img.Bounds().Dx()) / float64(w)))
				ch := int(math.Ceil(float64(img.Bounds().Dy()) / float64(h)))
				t.activeBuffer.addSixel(img, cw, ch)
				return true
			}
		}

		inEscape = false

		data = append(data, r.Rune)
	}
}
