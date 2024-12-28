package termutil

import (
	"fmt"
	"log/slog"
	"strconv"

	"github.com/charmbracelet/lipgloss"
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

func ColourFrom4Bit(code uint8) lipgloss.TerminalColor {
	colour, ok := map4Bit[code]
	if !ok {
		return lipgloss.NoColor{}
	}
	return lipgloss.ANSIColor(colour)
}

func DefaultBackground() lipgloss.TerminalColor {
	// red
	return lipgloss.ANSIColor(ColourBrightRed)
}

func DefaultForeground() lipgloss.TerminalColor {
	return lipgloss.NoColor{}
}

func ColourFrom8Bit(n string) (lipgloss.TerminalColor, error) {
	index, err := strconv.Atoi(n)
	if err != nil {
		return nil, err
	}
	slog.Info("converting", "index", index)

	if index < 16 {
		return lipgloss.ANSIColor(index), nil
	}

	if index >= 232 {
		c := ((index - 232) * 0xff) / 0x18
		hex := fmt.Sprintf("#%02x%02x%02x", c, c, c)
		return lipgloss.Color(hex), nil
	}

	var r, g, b uint8
	indexR := ((index - 16) / 36)
	if indexR > 0 {
		r = uint8(55 + indexR*40)
	}
	indexG := (((index - 16) % 36) / 6)
	if indexG > 0 {
		g = uint8(55 + indexG*40)
	}
	indexB := ((index - 16) % 6)
	if indexB > 0 {
		b = uint8(55 + indexB*40)
	}
	hex := fmt.Sprintf("#%02x%02x%02x", r, g, b)
	return lipgloss.Color(hex), nil
}

func ColourFrom24Bit(r, g, b string) (lipgloss.TerminalColor, error) {
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
	hex := fmt.Sprintf("#%02x%02x%02x", ri, gi, bi)
	return lipgloss.Color(hex), nil
}

func ColourFromAnsi(ansi []string, bg bool) (lipgloss.TerminalColor, error) {
	if len(ansi) == 0 {
		return nil, fmt.Errorf("invalid ansi colour code")
	}
	switch ansi[0] {
	case "2":
		if len(ansi) != 4 {
			return nil, fmt.Errorf("invalid 24-bit ansi colour code")
		}
		return ColourFrom24Bit(ansi[1], ansi[2], ansi[3])
	case "5":
		if len(ansi) != 2 {
			return nil, fmt.Errorf("invalid 8-bit ansi colour code")
		}
		return ColourFrom8Bit(ansi[1])
	default:
		return nil, fmt.Errorf("invalid ansi colour code")
	}
}
