package termutil

import (
	"image"
	"image/color"
	"sync"
)

const TabSize = 8

type CursorShape uint8

const (
	CursorShapeBlinkingBlock CursorShape = iota
	CursorShapeDefault
	CursorShapeSteadyBlock
	CursorShapeBlinkingUnderline
	CursorShapeSteadyUnderline
	CursorShapeBlinkingBar
	CursorShapeSteadyBar
)

type Buffer struct {
	lines                 []Line
	savedCursorPos        Position
	savedCursorAttr       *CellAttributes
	cursorShape           CursorShape
	savedCharsets         []*map[rune]rune
	savedCurrentCharset   int
	topMargin             uint // see DECSTBM docs - this is for scrollable regions
	bottomMargin          uint // see DECSTBM docs - this is for scrollable regions
	viewWidth             uint16
	viewHeight            uint16
	cursorPosition        Position // raw
	cursorAttr            CellAttributes
	scrollLinesFromBottom uint
	maxLines              uint64
	tabStops              []uint16
	charsets              []*map[rune]rune // array of 2 charsets, nil means ASCII (no conversion)
	currentCharset        int              // active charset index in charsets array, valid values are 0 or 1
	modes                 Modes
	selectionStart        *Position
	selectionEnd          *Position
	highlightStart        *Position
	highlightEnd          *Position
	highlightAnnotation   *Annotation
	sixels                []Sixel
	selectionMu           sync.Mutex
}

type Annotation struct {
	Image  image.Image
	Text   string
	Width  float64 // Width in cells
	Height float64 // Height in cells
}

type Selection struct {
	Start Position
	End   Position
}

type Position struct {
	Line uint64
	Col  uint16
}

// NewBuffer creates a new terminal buffer
func NewBuffer(width, height uint16, maxLines uint64, fg color.Color, bg color.Color) *Buffer {
	b := &Buffer{
		lines:        []Line{},
		viewHeight:   height,
		viewWidth:    width,
		maxLines:     maxLines,
		topMargin:    0,
		bottomMargin: uint(height - 1),
		cursorAttr: CellAttributes{
			fgColour: fg,
			bgColour: bg,
		},
		charsets: []*map[rune]rune{nil, nil},
		modes: Modes{
			LineFeedMode:   true,
			AutoWrap:       true,
			ShowCursor:     true,
			SixelScrolling: true,
		},
		cursorShape: CursorShapeDefault,
	}
	return b
}

func (buffer *Buffer) SetCursorShape(shape CursorShape) {
	buffer.cursorShape = shape
}

func (buffer *Buffer) GetCursorShape() CursorShape {
	return buffer.cursorShape
}

func (buffer *Buffer) IsCursorVisible() bool {
	return buffer.modes.ShowCursor
}

func (buffer *Buffer) IsApplicationCursorKeysModeEnabled() bool {
	return buffer.modes.ApplicationCursorKeys
}

func (buffer *Buffer) HasScrollableRegion() bool {
	return buffer.topMargin > 0 || buffer.bottomMargin < uint(buffer.ViewHeight())-1
}

func (buffer *Buffer) InScrollableRegion() bool {
	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)
	return buffer.HasScrollableRegion() && uint(cursorVY) >= buffer.topMargin && uint(cursorVY) <= buffer.bottomMargin
}

// NOTE: bottom is exclusive
func (buffer *Buffer) getAreaScrollRange() (top uint64, bottom uint64) {
	top = buffer.convertViewLineToRawLine(uint16(buffer.topMargin))
	bottom = buffer.convertViewLineToRawLine(uint16(buffer.bottomMargin)) + 1
	if bottom > uint64(len(buffer.lines)) {
		bottom = uint64(len(buffer.lines))
	}
	return top, bottom
}

func (buffer *Buffer) areaScrollDown(lines uint16) {

	// NOTE: bottom is exclusive
	top, bottom := buffer.getAreaScrollRange()

	for i := bottom; i > top; {
		i--
		if i >= top+uint64(lines) {
			buffer.lines[i] = buffer.lines[i-uint64(lines)]
		} else {
			buffer.lines[i] = newLine()
		}
	}
}

func (buffer *Buffer) areaScrollUp(lines uint16) {

	// NOTE: bottom is exclusive
	top, bottom := buffer.getAreaScrollRange()

	for i := top; i < bottom; i++ {
		from := i + uint64(lines)
		if from < bottom {
			buffer.lines[i] = buffer.lines[from]
		} else {
			buffer.lines[i] = newLine()
		}
	}
}

func (buffer *Buffer) saveCursor() {
	copiedAttr := buffer.cursorAttr
	buffer.savedCursorAttr = &copiedAttr
	buffer.savedCursorPos = buffer.cursorPosition
	buffer.savedCharsets = make([]*map[rune]rune, len(buffer.charsets))
	copy(buffer.savedCharsets, buffer.charsets)
	buffer.savedCurrentCharset = buffer.currentCharset
}

func (buffer *Buffer) restoreCursor() {
	// TODO: Do we need to restore attributes on cursor restore? conflicting sources but vim + htop work better without doing so
	//if buffer.savedCursorAttr != nil {
	// copiedAttr := *buffer.savedCursorAttr
	// copiedAttr.bgColour = buffer.defaultCell(false).attr.bgColour
	// copiedAttr.fgColour = buffer.defaultCell(false).attr.fgColour
	// buffer.cursorAttr = copiedAttr
	//}
	buffer.cursorPosition = buffer.savedCursorPos
	if buffer.savedCharsets != nil {
		buffer.charsets = make([]*map[rune]rune, len(buffer.savedCharsets))
		copy(buffer.charsets, buffer.savedCharsets)
		buffer.currentCharset = buffer.savedCurrentCharset
	}
}

func (buffer *Buffer) getCursorAttr() *CellAttributes {
	return &buffer.cursorAttr
}

func (buffer *Buffer) GetCell(viewCol uint16, viewRow uint16) *Cell {
	rawLine := buffer.convertViewLineToRawLine(viewRow)
	return buffer.getRawCell(viewCol, rawLine)
}

func (buffer *Buffer) getRawCell(viewCol uint16, rawLine uint64) *Cell {
	if rawLine >= uint64(len(buffer.lines)) {
		return nil
	}
	line := &buffer.lines[rawLine]
	if int(viewCol) >= len(line.cells) {
		return nil
	}
	return &line.cells[viewCol]
}

// Column returns cursor column
func (buffer *Buffer) CursorColumn() uint16 {
	// @todo originMode and left margin
	return buffer.cursorPosition.Col
}

// CursorLineAbsolute returns absolute cursor line coordinate (ignoring Origin Mode) - view format
func (buffer *Buffer) CursorLineAbsolute() uint16 {
	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)
	return cursorVY
}

// CursorLine returns cursor line (in Origin Mode it is relative to the top margin)
func (buffer *Buffer) CursorLine() uint16 {
	if buffer.modes.OriginMode {
		return buffer.CursorLineAbsolute() - uint16(buffer.topMargin)
	}
	return buffer.CursorLineAbsolute()
}

func (buffer *Buffer) TopMargin() uint {
	return buffer.topMargin
}

func (buffer *Buffer) BottomMargin() uint {
	return buffer.bottomMargin
}

// cursor Y (raw)
func (buffer *Buffer) RawLine() uint64 {
	return buffer.cursorPosition.Line
}

func (buffer *Buffer) convertViewLineToRawLine(viewLine uint16) uint64 {
	rawHeight := buffer.Height()
	if int(buffer.viewHeight) > rawHeight {
		return uint64(viewLine)
	}
	return uint64(int(viewLine) + (rawHeight - int(buffer.viewHeight+uint16(buffer.scrollLinesFromBottom))))
}

func (buffer *Buffer) convertRawLineToViewLine(rawLine uint64) uint16 {
	rawHeight := buffer.Height()
	if int(buffer.viewHeight) > rawHeight {
		return uint16(rawLine)
	}
	return uint16(int(rawLine) - (rawHeight - int(buffer.viewHeight+uint16(buffer.scrollLinesFromBottom))))
}

func (buffer *Buffer) GetVPosition() int {
	result := int(uint(buffer.Height()) - uint(buffer.ViewHeight()) - buffer.scrollLinesFromBottom)
	if result < 0 {
		result = 0
	}

	return result
}

// Width returns the width of the buffer in columns
func (buffer *Buffer) Width() uint16 {
	return buffer.viewWidth
}

func (buffer *Buffer) ViewWidth() uint16 {
	return buffer.viewWidth
}

func (buffer *Buffer) Height() int {
	return len(buffer.lines)
}

func (buffer *Buffer) ViewHeight() uint16 {
	return buffer.viewHeight
}

func (buffer *Buffer) deleteLine() {
	index := int(buffer.RawLine())
	buffer.lines = buffer.lines[:index+copy(buffer.lines[index:], buffer.lines[index+1:])]
}

func (buffer *Buffer) insertLine() {

	if !buffer.InScrollableRegion() {
		pos := buffer.RawLine()
		maxLines := buffer.GetMaxLines()
		newLineCount := uint64(len(buffer.lines) + 1)
		if newLineCount > maxLines {
			newLineCount = maxLines
		}

		out := make([]Line, newLineCount)
		copy(
			out[:pos-(uint64(len(buffer.lines))+1-newLineCount)],
			buffer.lines[uint64(len(buffer.lines))+1-newLineCount:pos])
		out[pos] = newLine()
		copy(out[pos+1:], buffer.lines[pos:])
		buffer.lines = out
	} else {
		topIndex := buffer.convertViewLineToRawLine(uint16(buffer.topMargin))
		bottomIndex := buffer.convertViewLineToRawLine(uint16(buffer.bottomMargin))
		before := buffer.lines[:topIndex]
		after := buffer.lines[bottomIndex+1:]
		out := make([]Line, len(buffer.lines))
		copy(out[0:], before)

		pos := buffer.RawLine()
		for i := topIndex; i < bottomIndex; i++ {
			if i < pos {
				out[i] = buffer.lines[i]
			} else {
				out[i+1] = buffer.lines[i]
			}
		}

		copy(out[bottomIndex+1:], after)

		out[pos] = newLine()
		buffer.lines = out
	}
}

func (buffer *Buffer) insertBlankCharacters(count int) {

	index := int(buffer.RawLine())
	for i := 0; i < count; i++ {
		cells := buffer.lines[index].cells
		buffer.lines[index].cells = append(cells[:buffer.cursorPosition.Col], append([]Cell{buffer.defaultCell(true)}, cells[buffer.cursorPosition.Col:]...)...)
	}
}

func (buffer *Buffer) insertLines(count int) {

	if buffer.HasScrollableRegion() && !buffer.InScrollableRegion() {
		// should have no effect outside of scrollable region
		return
	}

	buffer.cursorPosition.Col = 0

	for i := 0; i < count; i++ {
		buffer.insertLine()
	}

}

func (buffer *Buffer) deleteLines(count int) {

	if buffer.HasScrollableRegion() && !buffer.InScrollableRegion() {
		// should have no effect outside of scrollable region
		return
	}

	buffer.cursorPosition.Col = 0

	for i := 0; i < count; i++ {
		buffer.deleteLine()
	}

}

func (buffer *Buffer) index() {

	// This sequence causes the active position to move downward one line without changing the column position.
	// If the active position is at the bottom margin, a scroll up is performed."

	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)

	if buffer.InScrollableRegion() {

		if uint(cursorVY) < buffer.bottomMargin {
			buffer.cursorPosition.Line++
		} else {
			buffer.areaScrollUp(1)
		}

		return
	}

	if cursorVY >= buffer.ViewHeight()-1 {
		buffer.lines = append(buffer.lines, newLine())
		maxLines := buffer.GetMaxLines()
		if uint64(len(buffer.lines)) > maxLines {
			copy(buffer.lines, buffer.lines[uint64(len(buffer.lines))-maxLines:])
			buffer.lines = buffer.lines[:maxLines]
		}
	}
	buffer.cursorPosition.Line++
}

func (buffer *Buffer) reverseIndex() {

	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)

	if uint(cursorVY) == buffer.topMargin {
		buffer.areaScrollDown(1)
	} else if cursorVY > 0 {
		buffer.cursorPosition.Line--
	}
}

// write will write a rune to the terminal at the position of the cursor, and increment the cursor position
func (buffer *Buffer) write(runes ...MeasuredRune) {

	// scroll to bottom on input
	buffer.scrollLinesFromBottom = 0

	for _, r := range runes {

		line := buffer.getCurrentLine()

		if buffer.modes.ReplaceMode {

			if buffer.CursorColumn() >= buffer.Width() {
				if buffer.modes.AutoWrap {
					buffer.cursorPosition.Line++
					buffer.cursorPosition.Col = 0
					line = buffer.getCurrentLine()

				} else {
					// no more room on line and wrapping is disabled
					return
				}
			}

			for int(buffer.CursorColumn()) >= len(line.cells) {
				line.append(buffer.defaultCell(int(buffer.CursorColumn()) == len(line.cells)))
			}
			line.cells[buffer.cursorPosition.Col].attr = buffer.cursorAttr
			line.cells[buffer.cursorPosition.Col].setRune(r)
			buffer.incrementCursorPosition()
			continue
		}

		if buffer.CursorColumn() >= buffer.Width() { // if we're after the line, move to next

			if buffer.modes.AutoWrap {

				buffer.newLineEx(true)

				newLine := buffer.getCurrentLine()
				if len(newLine.cells) == 0 {
					newLine.append(buffer.defaultCell(true))
				}
				cell := &newLine.cells[0]
				cell.setRune(r)
				cell.attr = buffer.cursorAttr

			} else {
				// no more room on line and wrapping is disabled
				return
			}

		} else {

			for int(buffer.CursorColumn()) >= len(line.cells) {
				line.append(buffer.defaultCell(int(buffer.CursorColumn()) == len(line.cells)))
			}

			cell := &line.cells[buffer.CursorColumn()]
			cell.setRune(r)
			cell.attr = buffer.cursorAttr
		}

		buffer.incrementCursorPosition()
	}
}

func (buffer *Buffer) incrementCursorPosition() {
	// we can increment one column past the end of the line.
	// this is effectively the beginning of the next line, except when we \r etc.
	if buffer.CursorColumn() < buffer.Width() {
		buffer.cursorPosition.Col++
	}
}

func (buffer *Buffer) inDoWrap() bool {
	// xterm uses 'do_wrap' flag for this special terminal state
	// we use the cursor position right after the boundary
	// let's see how it works out
	return buffer.cursorPosition.Col == buffer.viewWidth // @todo rightMargin
}

func (buffer *Buffer) backspace() {

	if buffer.cursorPosition.Col == 0 {
		line := buffer.getCurrentLine()
		if line.wrapped {
			buffer.movePosition(int16(buffer.Width()-1), -1)
		}
	} else if buffer.inDoWrap() {
		// the "do_wrap" implementation
		buffer.movePosition(-2, 0)
	} else {
		buffer.movePosition(-1, 0)
	}
}

func (buffer *Buffer) carriageReturn() {

	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)

	for {
		line := buffer.getCurrentLine()
		if line == nil {
			break
		}
		if line.wrapped && cursorVY > 0 {
			buffer.cursorPosition.Line--
		} else {
			break
		}
	}

	buffer.cursorPosition.Col = 0
}

func (buffer *Buffer) tab() {

	tabStop := buffer.getNextTabStopAfter(buffer.cursorPosition.Col)
	for buffer.cursorPosition.Col < tabStop && buffer.cursorPosition.Col < buffer.viewWidth-1 { // @todo rightMargin
		buffer.write(MeasuredRune{Rune: ' ', Width: 1})
	}
}

// return next tab stop x pos
func (buffer *Buffer) getNextTabStopAfter(col uint16) uint16 {

	defaultStop := col + (TabSize - (col % TabSize))
	if defaultStop == col {
		defaultStop += TabSize
	}

	var low uint16
	for _, stop := range buffer.tabStops {
		if stop > col {
			if stop < low || low == 0 {
				low = stop
			}
		}
	}

	if low == 0 {
		return defaultStop
	}

	return low
}

func (buffer *Buffer) newLine() {
	buffer.newLineEx(false)
}

func (buffer *Buffer) verticalTab() {
	buffer.index()

	for {
		line := buffer.getCurrentLine()
		if !line.wrapped {
			break
		}
		buffer.index()
	}
}

func (buffer *Buffer) newLineEx(forceCursorToMargin bool) {

	if buffer.IsNewLineMode() || forceCursorToMargin {
		buffer.cursorPosition.Col = 0
	}
	buffer.index()

	for {
		line := buffer.getCurrentLine()
		if !line.wrapped {
			break
		}
		buffer.index()
	}
}

func (buffer *Buffer) movePosition(x int16, y int16) {

	var toX uint16
	var toY uint16

	if int16(buffer.CursorColumn())+x < 0 {
		toX = 0
	} else {
		toX = uint16(int16(buffer.CursorColumn()) + x)
	}

	// should either use CursorLine() and setPosition() or use absolutes, mind Origin Mode (DECOM)
	if int16(buffer.CursorLine())+y < 0 {
		toY = 0
	} else {
		toY = uint16(int16(buffer.CursorLine()) + y)
	}

	buffer.setPosition(toX, toY)
}

func (buffer *Buffer) setPosition(col uint16, line uint16) {

	useCol := col
	useLine := line
	maxLine := buffer.ViewHeight() - 1

	if buffer.modes.OriginMode {
		useLine += uint16(buffer.topMargin)
		maxLine = uint16(buffer.bottomMargin)
		// @todo left and right margins
	}
	if useLine > maxLine {
		useLine = maxLine
	}

	if useCol >= buffer.ViewWidth() {
		useCol = buffer.ViewWidth() - 1
	}

	buffer.cursorPosition.Col = useCol
	buffer.cursorPosition.Line = buffer.convertViewLineToRawLine(useLine)
}

func (buffer *Buffer) GetVisibleLines() []Line {
	lines := []Line{}

	for i := buffer.Height() - int(buffer.ViewHeight()); i < buffer.Height(); i++ {
		y := i - int(buffer.scrollLinesFromBottom)
		if y >= 0 && y < len(buffer.lines) {
			lines = append(lines, buffer.lines[y])
		}
	}
	return lines
}

// tested to here

func (buffer *Buffer) clear() {
	for i := 0; i < int(buffer.ViewHeight()); i++ {
		buffer.lines = append(buffer.lines, newLine())
	}
	buffer.setPosition(0, 0)
}

// creates if necessary
func (buffer *Buffer) getCurrentLine() *Line {
	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)
	return buffer.getViewLine(cursorVY)
}

func (buffer *Buffer) getViewLine(index uint16) *Line {

	if index >= buffer.ViewHeight() {
		return &buffer.lines[len(buffer.lines)-1]
	}

	if len(buffer.lines) < int(buffer.ViewHeight()) {
		for int(index) >= len(buffer.lines) {
			buffer.lines = append(buffer.lines, newLine())
		}
		return &buffer.lines[int(index)]
	}

	if raw := int(buffer.convertViewLineToRawLine(index)); raw < len(buffer.lines) {
		return &buffer.lines[raw]
	}

	return nil
}

func (buffer *Buffer) eraseLine() {

	buffer.clearSixelsAtRawLine(buffer.cursorPosition.Line)

	line := buffer.getCurrentLine()

	for i := 0; i < int(buffer.viewWidth); i++ {
		if i >= len(line.cells) {
			line.cells = append(line.cells, buffer.defaultCell(false))
		} else {
			line.cells[i] = buffer.defaultCell(false)
		}
	}
}

func (buffer *Buffer) eraseLineToCursor() {
	buffer.clearSixelsAtRawLine(buffer.cursorPosition.Line)
	line := buffer.getCurrentLine()
	for i := 0; i <= int(buffer.cursorPosition.Col); i++ {
		if i < len(line.cells) {
			line.cells[i].erase(buffer.cursorAttr.bgColour)
		}
	}
}

func (buffer *Buffer) eraseLineFromCursor() {
	buffer.clearSixelsAtRawLine(buffer.cursorPosition.Line)
	line := buffer.getCurrentLine()

	for i := buffer.cursorPosition.Col; i < buffer.viewWidth; i++ {
		if int(i) >= len(line.cells) {
			line.cells = append(line.cells, buffer.defaultCell(false))
		} else {
			line.cells[i] = buffer.defaultCell(false)
		}
	}
}

func (buffer *Buffer) eraseDisplay() {
	for i := uint16(0); i < (buffer.ViewHeight()); i++ {
		rawLine := buffer.convertViewLineToRawLine(i)
		buffer.clearSixelsAtRawLine(rawLine)
		if int(rawLine) < len(buffer.lines) {
			buffer.lines[int(rawLine)].cells = []Cell{}
		}
	}
}

func (buffer *Buffer) deleteChars(n int) {

	line := buffer.getCurrentLine()
	if int(buffer.cursorPosition.Col) >= len(line.cells) {
		return
	}
	before := line.cells[:buffer.cursorPosition.Col]
	if int(buffer.cursorPosition.Col)+n >= len(line.cells) {
		n = len(line.cells) - int(buffer.cursorPosition.Col)
	}
	after := line.cells[int(buffer.cursorPosition.Col)+n:]
	line.cells = append(before, after...)
}

func (buffer *Buffer) eraseCharacters(n int) {

	line := buffer.getCurrentLine()

	max := int(buffer.cursorPosition.Col) + n
	if max > len(line.cells) {
		max = len(line.cells)
	}

	for i := int(buffer.cursorPosition.Col); i < max; i++ {
		line.cells[i].erase(buffer.cursorAttr.bgColour)
	}
}

func (buffer *Buffer) eraseDisplayFromCursor() {
	line := buffer.getCurrentLine()

	max := int(buffer.cursorPosition.Col)
	if max > len(line.cells) {
		max = len(line.cells)
	}

	line.cells = line.cells[:max]

	for rawLine := buffer.cursorPosition.Line + 1; int(rawLine) < len(buffer.lines); rawLine++ {
		buffer.clearSixelsAtRawLine(rawLine)
		buffer.lines[int(rawLine)].cells = []Cell{}
	}
}

func (buffer *Buffer) eraseDisplayToCursor() {
	line := buffer.getCurrentLine()

	for i := 0; i <= int(buffer.cursorPosition.Col); i++ {
		if i >= len(line.cells) {
			break
		}
		line.cells[i].erase(buffer.cursorAttr.bgColour)
	}

	cursorVY := buffer.convertRawLineToViewLine(buffer.cursorPosition.Line)

	for i := uint16(0); i < cursorVY; i++ {
		rawLine := buffer.convertViewLineToRawLine(i)
		buffer.clearSixelsAtRawLine(rawLine)
		if int(rawLine) < len(buffer.lines) {
			buffer.lines[int(rawLine)].cells = []Cell{}
		}
	}
}

func (buffer *Buffer) GetMaxLines() uint64 {
	result := buffer.maxLines
	if result < uint64(buffer.viewHeight) {
		result = uint64(buffer.viewHeight)
	}

	return result
}

func (buffer *Buffer) setVerticalMargins(top uint, bottom uint) {
	buffer.topMargin = top
	buffer.bottomMargin = bottom
}

// resetVerticalMargins resets margins to extreme positions
func (buffer *Buffer) resetVerticalMargins(height uint) {
	buffer.setVerticalMargins(0, height-1)
}

func (buffer *Buffer) defaultCell(applyEffects bool) Cell {
	attr := buffer.cursorAttr
	if !applyEffects {
		attr.blink = false
		attr.bold = false
		attr.dim = false
		attr.inverse = false
		attr.underline = false
		attr.dim = false
	}
	return Cell{attr: attr}
}

func (buffer *Buffer) IsNewLineMode() bool {
	return !buffer.modes.LineFeedMode
}

func (buffer *Buffer) tabReset() {
	buffer.tabStops = nil
}

func (buffer *Buffer) tabSet(index uint16) {
	buffer.tabStops = append(buffer.tabStops, index)
}

func (buffer *Buffer) tabClear(index uint16) {
	var filtered []uint16
	for _, stop := range buffer.tabStops {
		if stop != buffer.cursorPosition.Col {
			filtered = append(filtered, stop)
		}
	}
	buffer.tabStops = filtered
}

func (buffer *Buffer) IsTabSetAtCursor() bool {
	if buffer.cursorPosition.Col%TabSize > 0 {
		return false
	}
	for _, stop := range buffer.tabStops {
		if stop == buffer.cursorPosition.Col {
			return true
		}
	}
	return false
}

func (buffer *Buffer) tabClearAtCursor() {
	buffer.tabClear(buffer.cursorPosition.Col)
}

func (buffer *Buffer) tabSetAtCursor() {
	buffer.tabSet(buffer.cursorPosition.Col)
}

func (buffer *Buffer) GetScrollOffset() uint {
	return buffer.scrollLinesFromBottom
}

func (buffer *Buffer) SetScrollOffset(offset uint) {
	buffer.scrollLinesFromBottom = offset
}

func (buffer *Buffer) ScrollToEnd() {
	buffer.scrollLinesFromBottom = 0
}

func (buffer *Buffer) ScrollUp(lines uint) {
	if int(buffer.scrollLinesFromBottom)+int(lines) < len(buffer.lines)-int(buffer.viewHeight) {
		buffer.scrollLinesFromBottom += lines
	} else {
		lines := len(buffer.lines) - int(buffer.viewHeight)
		if lines < 0 {
			lines = 0
		}
		buffer.scrollLinesFromBottom = uint(lines)
	}
}

func (buffer *Buffer) ScrollDown(lines uint) {
	if int(buffer.scrollLinesFromBottom)-int(lines) >= 0 {
		buffer.scrollLinesFromBottom -= lines
	} else {
		buffer.scrollLinesFromBottom = 0
	}
}
