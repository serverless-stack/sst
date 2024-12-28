package termutil

func (buffer *Buffer) shrink(width uint16) {

	var replace []Line

	prevCursor := int(buffer.cursorPosition.Line)

	for i, line := range buffer.lines {

		line.shrink(width)

		// this line fits within the new width restriction, keep it as is and continue
		if line.Len() <= width {
			replace = append(replace, line)
			continue
		}

		wrappedLines := line.wrap(width)

		if prevCursor >= i {
			buffer.cursorPosition.Line += uint64(len(wrappedLines) - 1)

		}

		replace = append(replace, wrappedLines...)
	}

	buffer.cursorPosition.Col = buffer.cursorPosition.Col % width

	buffer.lines = replace
}

func (buffer *Buffer) grow(width uint16) {

	var replace []Line
	var current Line

	prevCursor := int(buffer.cursorPosition.Line)

	for i, line := range buffer.lines {

		if !line.wrapped {
			if i > 0 {
				replace = append(replace, current)
			}
			current = newLine()
		}

		if i == prevCursor {
			buffer.cursorPosition.Line -= uint64(i - len(replace))
		}

		for _, cell := range line.cells {
			if len(current.cells) == int(width) {
				replace = append(replace, current)
				current = newLine()
				current.wrapped = true
			}
			current.cells = append(current.cells, cell)
		}

	}

	replace = append(replace, current)

	buffer.lines = replace
}

// deprecated
func (buffer *Buffer) resizeView(width uint16, height uint16) {

	if buffer.viewHeight == 0 {
		buffer.viewWidth = width
		buffer.viewHeight = height
		return
	}

	// scroll to bottom
	buffer.scrollLinesFromBottom = 0

	if width < buffer.viewWidth { // wrap lines if we're shrinking
		buffer.shrink(width)
		buffer.grow(width)
	} else if width > buffer.viewWidth { // unwrap lines if we're growing
		buffer.grow(width)
	}

	buffer.viewWidth = width
	buffer.viewHeight = height

	buffer.resetVerticalMargins(uint(buffer.viewHeight))
}
