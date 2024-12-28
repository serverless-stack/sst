package sixel

import "image/color"

type ColourMap struct {
	data [0x100]color.Color
}

func NewColourMap() *ColourMap {
	return &ColourMap{}
}

func (m *ColourMap) GetColour(id uint8) color.Color {
	return m.data[id]
}

func (m *ColourMap) SetColour(id uint8, c color.Color) {
	m.data[id] = c
}

func (m *ColourMap) FindColour(colour color.Color) (uint8, bool) {
	for id, c := range m.data {
		if c == colour {
			return uint8(id), true
		}
	}
	return 0, false
}
