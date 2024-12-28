package sixel

import (
	"fmt"
	"image"
	"image/color"
	"io"
	"strconv"
	"strings"
)

// See https://vt100.net/docs/vt3xx-gp/chapter14.html for more info.

type decoder struct {
	r             io.Reader
	cursor        image.Point
	aspectRatio   float64 // this is the ratio for vertical:horizontal pixels
	bg            color.Color
	colourMap     *ColourMap
	currentColour color.Color
	size          image.Point // does not limit image size, just where bg is drawn!
	scratchpad    map[int]map[int]color.Color
}

func Decode(reader io.Reader, bg color.Color) (image.Image, error) {
	return NewDecoder(reader, bg).Decode()
}

func NewDecoder(reader io.Reader, bg color.Color) *decoder {
	return &decoder{
		r:           reader,
		aspectRatio: 2,
		bg:          bg,
		colourMap:   NewColourMap(),
		scratchpad:  make(map[int]map[int]color.Color),
	}
}

func (d *decoder) Decode() (image.Image, error) {

	if err := d.processHeader(); err != nil {
		return nil, fmt.Errorf("error reading sixel header: %s", err)
	}

	if err := d.processBody(); err != nil {
		return nil, fmt.Errorf("error reading sixel header: %s", err)
	}

	return d.draw(), nil
}

func (d *decoder) readByte() (byte, error) {
	buf := make([]byte, 1)
	if _, err := d.r.Read(buf); err != nil {
		return 0, err
	}
	return buf[0], nil
}

func (d *decoder) readHeader() ([]byte, error) {
	var header []byte
	for {
		chr, err := d.readByte()
		if err != nil {
			return nil, err
		}
		if chr == 'q' {
			break
		}
		header = append(header, chr)
	}

	return header, nil
}

func (d *decoder) processHeader() error {

	data, err := d.readHeader()
	if err != nil {
		return err
	}

	header := string(data)

	if len(header) == 0 {
		return nil
	}

	params := strings.Split(header, ";")

	switch params[1] {
	case "0", "1", "5", "6", "":
		d.aspectRatio = 2
	case "2":
		d.aspectRatio = 5
	case "3", "4":
		d.aspectRatio = 3
	case "7", "8", "9":
		d.aspectRatio = 1
	default:
		return fmt.Errorf("invalid P1 in sixel header")
	}

	if len(params) == 1 {
		return nil
	}

	switch params[1] {
	case "0", "2", "":
		// use the configured terminal background colour
	case "1":
		d.bg = color.RGBA{A: 0} // transparent bg
	}

	// NOTE: we currently ignore P3 if it is specified

	if len(params) > 3 {
		return fmt.Errorf("unexpected extra parameters in sixel header")
	}

	return nil
}

func (d *decoder) processBody() error {

	for {

		byt, err := d.readByte()
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		if err := d.processChar(byt); err != nil {
			return err
		}
	}
}

func (d *decoder) handleRepeat() error {

	var countStr string

	for {
		byt, err := d.readByte()
		if err != nil {
			return err
		}

		switch true {
		case byt >= '0' && byt <= '9':
			countStr += string(byt)
		default:
			count, err := strconv.Atoi(countStr)
			if err != nil {
				return fmt.Errorf("invalid count in sixel repeat sequence: %s: %s", countStr, err)
			}
			for i := 0; i < count; i++ {
				if err := d.processDataChar(byt); err != nil {
					return err
				}
			}
			return nil
		}
	}
}

func (d *decoder) handleRasterAttributes() error {

	var arg string
	var args []string

	for {
		b, err := d.readByte()
		if err != nil {
			return err
		}

		switch true {
		case b >= '0' && b <= '9':
			arg += string(b)
		case b == ';':
			args = append(args, arg)
			arg = ""
		default:
			args = append(args, arg)
			if err := d.setRaster(args); err != nil {
				return err
			}
			return d.processChar(b)
		}
	}

}

func (d *decoder) setRaster(args []string) error {

	if len(args) != 4 {
		return fmt.Errorf("invalid raster command: %s", strings.Join(args, ";"))
	}

	pan, err := strconv.Atoi(args[0])
	if err != nil {
		return err
	}

	pad, err := strconv.Atoi(args[1])
	if err != nil {
		return err
	}

	d.aspectRatio = float64(pan) / float64(pad)

	ph, err := strconv.Atoi(args[2])
	if err != nil {
		return err
	}

	pv, err := strconv.Atoi(args[3])
	if err != nil {
		return err
	}

	d.size = image.Point{X: ph, Y: pv}

	return nil
}

func (d *decoder) handleColour() error {

	var arg string
	var args []string

	for {
		b, err := d.readByte()
		if err != nil {
			return err
		}

		switch true {
		case b >= '0' && b <= '9':
			arg += string(b)
		case b == ';':
			args = append(args, arg)
			arg = ""
		default:
			args = append(args, arg)
			if err := d.setColour(args); err != nil {
				return err
			}
			return d.processChar(b)
		}
	}
}

func (d *decoder) setColour(args []string) error {

	if len(args) == 0 {
		return fmt.Errorf("invalid colour string - missing identifier")
	}

	colourID, err := strconv.Atoi(args[0])
	if err != nil {
		return fmt.Errorf("invalid colour id: %s", args[0])
	}

	if len(args) == 1 {
		d.currentColour = d.colourMap.GetColour(uint8(colourID))
		return nil
	}

	if len(args) != 5 {
		return fmt.Errorf("invalid colour introduction command - wrong number of args (%d): %s", len(args), strings.Join(args, ";"))
	}

	x, err := strconv.Atoi(args[2])
	if err != nil {
		return fmt.Errorf("invalid colour value")
	}

	y, err := strconv.Atoi(args[3])
	if err != nil {
		return fmt.Errorf("invalid colour value")
	}

	z, err := strconv.Atoi(args[4])
	if err != nil {
		return fmt.Errorf("invalid colour value")
	}

	var colour color.Color

	switch args[1] {
	case "1":
		colour = colourFromHSL(x, z, y)
	case "2":
		colour = color.RGBA{
			R: uint8((x * 255) / 100),
			G: uint8((y * 255) / 100),
			B: uint8((z * 255) / 100),
			A: 0xff,
		}
	default:
		return fmt.Errorf("invalid colour co-ordinate system '%s'", args[1])
	}

	d.colourMap.SetColour(uint8(colourID), colour)
	d.currentColour = colour
	return nil
}

func (d *decoder) processChar(b byte) error {

	switch b {
	case '!':
		return d.handleRepeat()
	case '"':
		return d.handleRasterAttributes()
	case '#':
		return d.handleColour()
	case '$':
		// graphics carriage return
		d.cursor.X = 0
		return nil
	case '-':
		// graphics new line
		d.cursor.Y += 6
		d.cursor.X = 0
		return nil
	default:
		return d.processDataChar(b)
	}
}

func (d *decoder) processDataChar(b byte) error {
	if b < 0x3f || b > 0x7e {
		return fmt.Errorf("invalid sixel data value 0x%02x: outside acceptable range", b)
	}

	sixel := b - 0x3f

	for i := 0; i < 6; i++ {
		if sixel&(1<<i) > 0 {
			d.set(d.cursor.X, d.cursor.Y+i)
		}
	}

	d.cursor.X++
	return nil
}

func hueToRGB(v1, v2, h float64) float64 {
	if h < 0 {
		h += 1
	}
	if h > 1 {
		h -= 1
	}
	switch {
	case 6*h < 1:
		return (v1 + (v2-v1)*6*h)
	case 2*h < 1:
		return v2
	case 3*h < 2:
		return v1 + (v2-v1)*((2.0/3.0)-h)*6
	}
	return v1
}

func colourFromHSL(hi, si, li int) color.Color {

	h := float64(hi) / 360
	s := float64(si) / 100
	l := float64(li) / 100

	if s == 0 {
		// it's gray
		return color.RGBA{uint8(l * 0xff), uint8(l * 0xff), uint8(l * 0xff), 0xff}
	}

	var v1, v2 float64
	if l < 0.5 {
		v2 = l * (1 + s)
	} else {
		v2 = (l + s) - (s * l)
	}

	v1 = 2*l - v2

	r := hueToRGB(v1, v2, h+(1.0/3.0))
	g := hueToRGB(v1, v2, h)
	b := hueToRGB(v1, v2, h-(1.0/3.0))

	return color.RGBA{R: uint8(r * 0xff), G: uint8(g * 0xff), B: uint8(b * 0xff), A: 0xff}
}

func (d *decoder) set(x, y int) {

	if x > d.size.X {
		d.size.X = x
	}

	if y > d.size.Y {
		d.size.Y = y
	}

	if _, ok := d.scratchpad[x]; !ok {
		d.scratchpad[x] = make(map[int]color.Color)
	}

	d.scratchpad[x][y] = d.currentColour
}

func (d *decoder) draw() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, d.size.X, d.size.Y))

	for x := 0; x < d.size.X; x++ {
		for y := 0; y < d.size.Y; y++ {
			c := d.bg
			if col, ok := d.scratchpad[x]; ok {
				if row, ok := col[y]; ok {
					c = row
				}
			}
			img.Set(x, y, c)
		}
	}

	return img
}
