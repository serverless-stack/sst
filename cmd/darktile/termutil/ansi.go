package termutil

func (t *Terminal) handleANSI(readChan chan MeasuredRune) (renderRequired bool) {
	// if the byte is an escape character, read the next byte to determine which one
	r := <-readChan

	t.log("ANSI SEQ %c 0x%X", r.Rune, r.Rune)

	t.mu.Lock()
	defer t.mu.Unlock()

	switch r.Rune {
	case '[':
		return t.handleCSI(readChan)
	case ']':
		return t.handleOSC(readChan)
	case '(':
		return t.handleSCS0(readChan) // select character set into G0
	case ')':
		return t.handleSCS1(readChan) // select character set into G1
	case '*':
		return swallowHandler(1)(readChan) // character set bullshit
	case '+':
		return swallowHandler(1)(readChan) // character set bullshit
	case '>':
		return swallowHandler(0)(readChan) // numeric char selection
	case '=':
		return swallowHandler(0)(readChan) // alt char selection
	case '7':
		t.GetActiveBuffer().saveCursor()
	case '8':
		t.GetActiveBuffer().restoreCursor()
	case 'D':
		t.GetActiveBuffer().index()
	case 'E':
		t.GetActiveBuffer().newLineEx(true)
	case 'H':
		t.GetActiveBuffer().tabSetAtCursor()
	case 'M':
		t.GetActiveBuffer().reverseIndex()
	case 'P': // sixel
		t.handleSixel(readChan)
	case 'c':
		t.GetActiveBuffer().clear()
	case '#':
		return t.handleScreenState(readChan)
	case '^':
		return t.handlePrivacyMessage(readChan)
	default:
		t.log("UNKNOWN ESCAPE SEQUENCE: 0x%X", r.Rune)
		return false
	}

	return true
}

func swallowHandler(size int) func(pty chan MeasuredRune) bool {
	return func(pty chan MeasuredRune) bool {
		for i := 0; i < size; i++ {
			<-pty
		}
		return false
	}
}

func (t *Terminal) handleScreenState(readChan chan MeasuredRune) bool {
	b := <-readChan
	switch b.Rune {
	case '8': // DECALN -- Screen Alignment Pattern

		// hide cursor?
		buffer := t.GetActiveBuffer()
		buffer.resetVerticalMargins(uint(buffer.viewHeight))
		buffer.SetScrollOffset(0)

		// Fill the whole screen with E's
		count := buffer.ViewHeight() * buffer.ViewWidth()
		for count > 0 {
			buffer.write(MeasuredRune{Rune: 'E', Width: 1})
			count--
			if count > 0 && !buffer.modes.AutoWrap && count%buffer.ViewWidth() == 0 {
				buffer.index()
				buffer.carriageReturn()
			}
		}
		// restore cursor
		buffer.setPosition(0, 0)
	default:
		return false
	}
	return true
}

func (t *Terminal) handlePrivacyMessage(readChan chan MeasuredRune) bool {
	isEscaped := false
	for {
		b := <-readChan
		if b.Rune == 0x18 /*CAN*/ || b.Rune == 0x1a /*SUB*/ || (b.Rune == 0x5c /*backslash*/ && isEscaped) {
			break
		}
		if isEscaped {
			isEscaped = false
		} else if b.Rune == 0x1b {
			isEscaped = true
			continue
		}
	}
	return false
}
