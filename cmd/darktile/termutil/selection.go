package termutil

func (buffer *Buffer) ClearSelection() {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()
	buffer.selectionStart = nil
	buffer.selectionEnd = nil
}

func (buffer *Buffer) GetBoundedTextAtPosition(pos Position) (start Position, end Position, text string, textIndex int, found bool) {
	return buffer.FindWordAt(pos, func(r rune) bool {
		return r > 0 && r < 256
	})
}

// if the selection is invalid - e.g. lines are selected that no longer exist in the buffer
func (buffer *Buffer) fixSelection() bool {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()

	if buffer.selectionStart == nil || buffer.selectionEnd == nil {
		return false
	}

	if buffer.selectionStart.Line >= uint64(len(buffer.lines)) {
		buffer.selectionStart.Line = uint64(len(buffer.lines)) - 1
	}

	if buffer.selectionEnd.Line >= uint64(len(buffer.lines)) {
		buffer.selectionEnd.Line = uint64(len(buffer.lines)) - 1
	}

	if buffer.selectionStart.Col >= uint16(len(buffer.lines[buffer.selectionStart.Line].cells)) {
		buffer.selectionStart.Col = 0
		if buffer.selectionStart.Line < uint64(len(buffer.lines))-1 {
			buffer.selectionStart.Line++
		}
	}

	if buffer.selectionEnd.Col >= uint16(len(buffer.lines[buffer.selectionEnd.Line].cells)) {
		buffer.selectionEnd.Col = uint16(len(buffer.lines[buffer.selectionEnd.Line].cells)) - 1
	}

	return true
}

func (buffer *Buffer) ExtendSelectionToEntireLines() {
	if !buffer.fixSelection() {
		return
	}

	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()

	buffer.selectionStart.Col = 0
	buffer.selectionEnd.Col = uint16(len(buffer.lines[buffer.selectionEnd.Line].cells)) - 1
}

type RuneMatcher func(r rune) bool

func (buffer *Buffer) SelectWordAt(pos Position, runeMatcher RuneMatcher) {
	start, end, _, _, found := buffer.FindWordAt(pos, runeMatcher)
	if !found {
		return
	}
	buffer.setRawSelectionStart(start)
	buffer.setRawSelectionEnd(end)
}

// takes raw coords
func (buffer *Buffer) Highlight(start Position, end Position, annotation *Annotation) {
	buffer.highlightStart = &start
	buffer.highlightEnd = &end
	buffer.highlightAnnotation = annotation
}

func (buffer *Buffer) ClearHighlight() {
	buffer.highlightStart = nil
	buffer.highlightEnd = nil
}

// returns raw lines
func (buffer *Buffer) FindWordAt(pos Position, runeMatcher RuneMatcher) (start Position, end Position, text string, textIndex int, found bool) {
	line := buffer.convertViewLineToRawLine(uint16(pos.Line))
	col := pos.Col

	if line >= uint64(len(buffer.lines)) {
		return
	}
	if col >= uint16(len(buffer.lines[line].cells)) {
		return
	}

	if !runeMatcher(buffer.lines[line].cells[col].r.Rune) {
		return
	}

	found = true

	start = Position{
		Line: line,
		Col:  col,
	}
	end = Position{
		Line: line,
		Col:  col,
	}

	var startCol uint16
BACK:
	for y := int(line); y >= 0; y-- {
		if y == int(line) {
			startCol = col
		} else {
			if len(buffer.lines[y].cells) < int(buffer.viewWidth) {
				break
			}
			startCol = uint16(len(buffer.lines[y].cells) - 1)
		}
		for x := int(startCol); x >= 0; x-- {
			if runeMatcher(buffer.lines[y].cells[x].r.Rune) {
				start = Position{
					Line: uint64(y),
					Col:  uint16(x),
				}
				text = string(buffer.lines[y].cells[x].r.Rune) + text
			} else {
				break BACK
			}
		}

	}
	textIndex = len([]rune(text)) - 1
FORWARD:
	for y := uint64(line); y < uint64(len(buffer.lines)); y++ {
		if y == line {
			startCol = col + 1
		} else {
			startCol = 0
		}
		for x := int(startCol); x < len(buffer.lines[y].cells); x++ {
			if runeMatcher(buffer.lines[y].cells[x].r.Rune) {
				end = Position{
					Line: y,
					Col:  uint16(x),
				}
				text = text + string(buffer.lines[y].cells[x].r.Rune)
			} else {
				break FORWARD
			}
		}
		if len(buffer.lines[y].cells) < int(buffer.viewWidth) {
			break
		}
	}

	return
}

func (buffer *Buffer) SetSelectionStart(pos Position) {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()
	buffer.selectionStart = &Position{
		Col:  pos.Col,
		Line: buffer.convertViewLineToRawLine(uint16(pos.Line)),
	}
}

func (buffer *Buffer) setRawSelectionStart(pos Position) {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()
	buffer.selectionStart = &pos
}

func (buffer *Buffer) SetSelectionEnd(pos Position) {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()
	buffer.selectionEnd = &Position{
		Col:  pos.Col,
		Line: buffer.convertViewLineToRawLine(uint16(pos.Line)),
	}
}

func (buffer *Buffer) setRawSelectionEnd(pos Position) {
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()
	buffer.selectionEnd = &pos
}

func (buffer *Buffer) GetSelection() (string, *Selection) {
	if !buffer.fixSelection() {
		return "", nil
	}

	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()

	start := *buffer.selectionStart
	end := *buffer.selectionEnd

	if end.Line < start.Line || (end.Line == start.Line && end.Col < start.Col) {
		swap := end
		end = start
		start = swap
	}

	var text string
	for y := start.Line; y <= end.Line; y++ {
		if y >= uint64(len(buffer.lines)) {
			break
		}
		line := buffer.lines[y]
		startX := 0
		endX := len(line.cells) - 1
		if y == start.Line {
			startX = int(start.Col)
		}
		if y == end.Line {
			endX = int(end.Col)
		}
		if y > start.Line {
			text += "\n"
		}
		for x := startX; x <= endX; x++ {
			if x >= len(line.cells) {
				break
			}
			mr := line.cells[x].Rune()
			if mr.Width == 0 {
				continue
			}
			x += mr.Width - 1
			text += string(mr.Rune)
		}
	}

	viewSelection := Selection{
		Start: start,
		End:   end,
	}

	viewSelection.Start.Line = uint64(buffer.convertRawLineToViewLine(viewSelection.Start.Line))
	viewSelection.End.Line = uint64(buffer.convertRawLineToViewLine(viewSelection.End.Line))
	return text, &viewSelection
}

func (buffer *Buffer) InSelection(pos Position) bool {

	if !buffer.fixSelection() {
		return false
	}
	buffer.selectionMu.Lock()
	defer buffer.selectionMu.Unlock()

	start := *buffer.selectionStart
	end := *buffer.selectionEnd

	if end.Line < start.Line || (end.Line == start.Line && end.Col < start.Col) {
		swap := end
		end = start
		start = swap
	}

	rY := buffer.convertViewLineToRawLine(uint16(pos.Line))
	if rY < start.Line {
		return false
	}
	if rY > end.Line {
		return false
	}
	if rY == start.Line {
		if pos.Col < start.Col {
			return false
		}
	}
	if rY == end.Line {
		if pos.Col > end.Col {
			return false
		}
	}

	return true
}

func (buffer *Buffer) GetHighlightAnnotation() *Annotation {
	return buffer.highlightAnnotation
}

func (buffer *Buffer) GetViewHighlight() (start Position, end Position, exists bool) {

	if buffer.highlightStart == nil || buffer.highlightEnd == nil {
		return
	}

	if buffer.highlightStart.Line >= uint64(len(buffer.lines)) {
		return
	}

	if buffer.highlightEnd.Line >= uint64(len(buffer.lines)) {
		return
	}

	if buffer.highlightStart.Col >= uint16(len(buffer.lines[buffer.highlightStart.Line].cells)) {
		return
	}

	if buffer.highlightEnd.Col >= uint16(len(buffer.lines[buffer.highlightEnd.Line].cells)) {
		return
	}

	start = *buffer.highlightStart
	end = *buffer.highlightEnd

	if end.Line < start.Line || (end.Line == start.Line && end.Col < start.Col) {
		swap := end
		end = start
		start = swap
	}

	start.Line = uint64(buffer.convertRawLineToViewLine(start.Line))
	end.Line = uint64(buffer.convertRawLineToViewLine(end.Line))

	return start, end, true
}
