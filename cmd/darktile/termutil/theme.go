package termutil

import (
	"fmt"
	"image/color"
	"strconv"
)

type Colour uint8

// See https://en.wikipedia.org/wiki/ANSI_escape_code#3-bit_and_4-bit
const (
	ColourBlack Colour = iota
	ColourRed
	ColourGreen
	ColourYellow
	ColourBlue
	ColourMagenta
	ColourCyan
	ColourWhite
	ColourBrightBlack
	ColourBrightRed
	ColourBrightGreen
	ColourBrightYellow
	ColourBrightBlue
	ColourBrightMagenta
	ColourBrightCyan
	ColourBrightWhite
	ColourBackground
	ColourForeground
	ColourSelectionBackground
	ColourSelectionForeground
	ColourCursorForeground
	ColourCursorBackground
)

type Theme struct {
	colourMap map[Colour]color.Color
}

var (
	map4Bit = map[uint8]Colour{
		30:  ColourBlack,
		31:  ColourRed,
		32:  ColourGreen,
		33:  ColourYellow,
		34:  ColourBlue,
		35:  ColourMagenta,
		36:  ColourCyan,
		37:  ColourWhite,
		90:  ColourBrightBlack,
		91:  ColourBrightRed,
		92:  ColourBrightGreen,
		93:  ColourBrightYellow,
		94:  ColourBrightBlue,
		95:  ColourBrightMagenta,
		96:  ColourBrightCyan,
		97:  ColourBrightWhite,
		40:  ColourBlack,
		41:  ColourRed,
		42:  ColourGreen,
		43:  ColourYellow,
		44:  ColourBlue,
		45:  ColourMagenta,
		46:  ColourCyan,
		47:  ColourWhite,
		100: ColourBrightBlack,
		101: ColourBrightRed,
		102: ColourBrightGreen,
		103: ColourBrightYellow,
		104: ColourBrightBlue,
		105: ColourBrightMagenta,
		106: ColourBrightCyan,
		107: ColourBrightWhite,
	}
)

func (t *Theme) ColourFrom4Bit(code uint8) color.Color {
	colour, ok := map4Bit[code]
	if !ok {
		return color.Black
	}
	return t.colourMap[colour]
}

func (t *Theme) DefaultBackground() color.Color {
	c, ok := t.colourMap[ColourBackground]
	if !ok {
		return color.RGBA{0, 0, 0, 0xff}
	}
	return c
}

func (t *Theme) DefaultForeground() color.Color {
	c, ok := t.colourMap[ColourForeground]
	if !ok {
		return color.RGBA{255, 255, 255, 0xff}
	}
	return c
}

func (t *Theme) SelectionBackground() color.Color {
	c, ok := t.colourMap[ColourSelectionBackground]
	if !ok {
		return color.RGBA{0, 0, 0, 0xff}
	}
	return c
}

func (t *Theme) SelectionForeground() color.Color {
	c, ok := t.colourMap[ColourSelectionForeground]
	if !ok {
		return color.RGBA{255, 255, 255, 0xff}
	}
	return c
}

func (t *Theme) CursorBackground() color.Color {
	c, ok := t.colourMap[ColourCursorBackground]
	if !ok {
		return color.RGBA{255, 255, 255, 0xff}
	}
	return c
}

func (t *Theme) CursorForeground() color.Color {
	c, ok := t.colourMap[ColourCursorForeground]
	if !ok {
		return color.RGBA{0, 0, 0, 0xff}
	}
	return c
}

func (t *Theme) ColourFrom8Bit(n string) (color.Color, error) {

	index, err := strconv.Atoi(n)
	if err != nil {
		return nil, err
	}

	if index < 16 {
		return t.colourMap[Colour(index)], nil
	}

	if index >= 232 {
		c := ((index - 232) * 0xff) / 0x18
		return color.RGBA{
			R: byte(c),
			G: byte(c),
			B: byte(c),
			A: 0xff,
		}, nil
	}

	var colour color.RGBA
	colour.A = 0xff
	indexR := ((index - 16) / 36)
	if indexR > 0 {
		colour.R = uint8(55 + indexR*40)
	}
	indexG := (((index - 16) % 36) / 6)
	if indexG > 0 {
		colour.G = uint8(55 + indexG*40)
	}
	indexB := ((index - 16) % 6)
	if indexB > 0 {
		colour.B = uint8(55 + indexB*40)
	}

	return colour, nil
}

func (t *Theme) ColourFrom24Bit(r, g, b string) (color.Color, error) {
	ri, err := strconv.Atoi(r)
	if err != nil {
		return nil, err
	}
	gi, err := strconv.Atoi(g)
	if err != nil {
		return nil, err
	}
	bi, err := strconv.Atoi(b)
	if err != nil {
		return nil, err
	}
	return color.RGBA{
		R: byte(ri),
		G: byte(gi),
		B: byte(bi),
		A: 0xff,
	}, nil
}

func (t *Theme) ColourFromAnsi(ansi []string, bg bool) (color.Color, error) {

	if len(ansi) == 0 {
		return nil, fmt.Errorf("invalid ansi colour code")
	}

	switch ansi[0] {
	case "2":
		if len(ansi) != 4 {
			return nil, fmt.Errorf("invalid 24-bit ansi colour code")
		}
		return t.ColourFrom24Bit(ansi[1], ansi[2], ansi[3])
	case "5":
		if len(ansi) != 2 {
			return nil, fmt.Errorf("invalid 8-bit ansi colour code")
		}
		return t.ColourFrom8Bit(ansi[1])
	default:
		return nil, fmt.Errorf("invalid ansi colour code")
	}
}
