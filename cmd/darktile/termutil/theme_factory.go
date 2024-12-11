package termutil

import "image/color"

type ThemeFactory struct {
	theme     *Theme
	colourMap map[Colour]color.Color
}

func NewThemeFactory() *ThemeFactory {
	return &ThemeFactory{
		theme: &Theme{
			colourMap: map[Colour]color.Color{},
		},
		colourMap: make(map[Colour]color.Color),
	}
}

func (t *ThemeFactory) Build() *Theme {
	for id, col := range t.colourMap {
		r, g, b, _ := col.RGBA()
		t.theme.colourMap[id] = color.RGBA{
			R: uint8(r / 0xff),
			G: uint8(g / 0xff),
			B: uint8(b / 0xff),
			A: 0xff,
		}
	}
	return t.theme
}

func (t *ThemeFactory) WithColour(key Colour, colour color.Color) *ThemeFactory {
	t.colourMap[key] = colour
	return t
}
