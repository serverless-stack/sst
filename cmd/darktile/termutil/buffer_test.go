package termutil

import (
	"image/color"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
)

func writeRaw(buf *Buffer, runes ...rune) {
	for _, r := range runes {
		buf.write(MeasuredRune{Rune: r, Width: 1})
	}
}

func TestBufferCreation(t *testing.T) {
	b := makeBufferForTesting(10, 20)
	assert.Equal(t, uint16(10), b.Width())
	assert.Equal(t, uint16(20), b.ViewHeight())
	assert.Equal(t, uint16(0), b.CursorColumn())
	assert.Equal(t, uint16(0), b.CursorLine())
	assert.NotNil(t, b.lines)
}

func TestNewLine(t *testing.T) {
	b := makeBufferForTesting(30, 3)
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("goodbye")...)
	b.carriageReturn()
	b.newLine()
	expected := `
hello
goodbye
`

	lines := b.GetVisibleLines()
	strs := []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, strings.TrimSpace(expected), strings.TrimSpace(strings.Join(strs, "\n")))
}

func TestTabbing(t *testing.T) {
	b := makeBufferForTesting(30, 3)
	writeRaw(b, []rune("hello")...)
	b.tab()
	writeRaw(b, []rune("x")...)
	b.tab()
	writeRaw(b, []rune("goodbye")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hell")...)
	b.tab()
	writeRaw(b, []rune("xxx")...)
	b.tab()
	writeRaw(b, []rune("good")...)
	b.carriageReturn()
	b.newLine()
	expected := `
hello   x       goodbye
hell    xxx     good
`

	lines := b.GetVisibleLines()
	strs := []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, strings.TrimSpace(expected), strings.TrimSpace(strings.Join(strs, "\n")))
}

func TestOffsets(t *testing.T) {
	b := makeBufferForTesting(10, 3)
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello")...)
	assert.Equal(t, uint16(10), b.ViewWidth())
	assert.Equal(t, uint16(10), b.Width())
	assert.Equal(t, uint16(3), b.ViewHeight())
	assert.Equal(t, 5, b.Height())
}

func TestBufferWriteIncrementsCursorCorrectly(t *testing.T) {
	b := makeBufferForTesting(5, 4)

	/*01234
	 |-----
	0|xxxxx
	1|
	2|
	3|
	 |-----
	*/

	writeRaw(b, 'x')
	require.Equal(t, uint16(1), b.CursorColumn())
	require.Equal(t, uint16(0), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(2), b.CursorColumn())
	require.Equal(t, uint16(0), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(3), b.CursorColumn())
	require.Equal(t, uint16(0), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(4), b.CursorColumn())
	require.Equal(t, uint16(0), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(5), b.CursorColumn())
	require.Equal(t, uint16(0), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(1), b.CursorColumn())
	require.Equal(t, uint16(1), b.CursorLine())

	writeRaw(b, 'x')
	require.Equal(t, uint16(2), b.CursorColumn())
	require.Equal(t, uint16(1), b.CursorLine())

	lines := b.GetVisibleLines()
	require.Equal(t, 2, len(lines))
	assert.Equal(t, "xxxxx", lines[0].String())
	assert.Equal(t, "xx", lines[1].String())

}

func TestWritingNewLineAsFirstRuneOnWrappedLine(t *testing.T) {
	b := makeBufferForTesting(3, 20)
	b.modes.LineFeedMode = false

	writeRaw(b, 'a', 'b', 'c')
	assert.Equal(t, uint16(3), b.cursorPosition.Col)
	assert.Equal(t, uint64(0), b.cursorPosition.Line)
	b.newLine()
	assert.Equal(t, uint16(0), b.cursorPosition.Col)
	assert.Equal(t, uint64(1), b.cursorPosition.Line)

	writeRaw(b, 'd', 'e', 'f')
	assert.Equal(t, uint16(3), b.cursorPosition.Col)
	assert.Equal(t, uint64(1), b.cursorPosition.Line)
	b.newLine()

	assert.Equal(t, uint16(0), b.cursorPosition.Col)
	assert.Equal(t, uint64(2), b.cursorPosition.Line)

	require.Equal(t, 3, len(b.lines))
	assert.Equal(t, "abc", b.lines[0].String())
	assert.Equal(t, "def", b.lines[1].String())

}

func TestWritingNewLineAsSecondRuneOnWrappedLine(t *testing.T) {
	b := makeBufferForTesting(3, 20)
	b.modes.LineFeedMode = false
	/*
		|abc
		|d
		|ef
		|
		|
		|z
	*/

	writeRaw(b, 'a', 'b', 'c', 'd')
	b.newLine()
	writeRaw(b, 'e', 'f')
	b.newLine()
	b.newLine()
	b.newLine()
	writeRaw(b, 'z')

	assert.Equal(t, "abc", b.lines[0].String())
	assert.Equal(t, "d", b.lines[1].String())
	assert.Equal(t, "ef", b.lines[2].String())
	assert.Equal(t, "", b.lines[3].String())
	assert.Equal(t, "", b.lines[4].String())
	assert.Equal(t, "z", b.lines[5].String())
}

func TestSetPosition(t *testing.T) {
	b := makeBufferForTesting(120, 80)
	assert.Equal(t, 0, int(b.CursorColumn()))
	assert.Equal(t, 0, int(b.CursorLine()))

	b.setPosition(60, 10)
	assert.Equal(t, 60, int(b.CursorColumn()))
	assert.Equal(t, 10, int(b.CursorLine()))

	b.setPosition(0, 0)
	assert.Equal(t, 0, int(b.CursorColumn()))
	assert.Equal(t, 0, int(b.CursorLine()))

	b.setPosition(120, 90)
	assert.Equal(t, 119, int(b.CursorColumn()))
	assert.Equal(t, 79, int(b.CursorLine()))

}

func TestMovePosition(t *testing.T) {
	b := makeBufferForTesting(120, 80)
	assert.Equal(t, 0, int(b.CursorColumn()))
	assert.Equal(t, 0, int(b.CursorLine()))

	b.movePosition(-1, -1)
	assert.Equal(t, 0, int(b.CursorColumn()))
	assert.Equal(t, 0, int(b.CursorLine()))

	b.movePosition(30, 20)
	assert.Equal(t, 30, int(b.CursorColumn()))
	assert.Equal(t, 20, int(b.CursorLine()))

	b.movePosition(30, 20)
	assert.Equal(t, 60, int(b.CursorColumn()))
	assert.Equal(t, 40, int(b.CursorLine()))

	b.movePosition(-1, -1)
	assert.Equal(t, 59, int(b.CursorColumn()))
	assert.Equal(t, 39, int(b.CursorLine()))

	b.movePosition(100, 100)
	assert.Equal(t, 119, int(b.CursorColumn()))
	assert.Equal(t, 79, int(b.CursorLine()))

}

func TestVisibleLines(t *testing.T) {
	b := makeBufferForTesting(80, 10)
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 2")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 3")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 4")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 5")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 6")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 7")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 8")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 9")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 10")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 11")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 12")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 13")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 14")...)

	lines := b.GetVisibleLines()
	require.Equal(t, 10, len(lines))
	assert.Equal(t, "hello 5", lines[0].String())
	assert.Equal(t, "hello 14", lines[9].String())

}

func TestClearWithoutFullView(t *testing.T) {
	b := makeBufferForTesting(80, 10)
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.clear()
	lines := b.GetVisibleLines()
	for _, line := range lines {
		assert.Equal(t, "", line.String())
	}
}

func TestClearWithFullView(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("hello 1")...)
	b.clear()
	lines := b.GetVisibleLines()
	for _, line := range lines {
		assert.Equal(t, "", line.String())
	}
}

func TestCarriageReturn(t *testing.T) {
	b := makeBufferForTesting(80, 20)
	writeRaw(b, []rune("hello!")...)
	b.carriageReturn()
	writeRaw(b, []rune("secret")...)
	lines := b.GetVisibleLines()
	assert.Equal(t, "secret", lines[0].String())
}

func TestCarriageReturnOnFullLine(t *testing.T) {
	b := makeBufferForTesting(20, 20)
	writeRaw(b, []rune("abcdeabcdeabcdeabcde")...)
	b.carriageReturn()
	writeRaw(b, []rune("xxxxxxxxxxxxxxxxxxxx")...)
	lines := b.GetVisibleLines()
	assert.Equal(t, "xxxxxxxxxxxxxxxxxxxx", lines[0].String())
}

func TestCarriageReturnOnFullLastLine(t *testing.T) {
	b := makeBufferForTesting(20, 2)
	b.newLine()
	writeRaw(b, []rune("abcdeabcdeabcdeabcde")...)
	b.carriageReturn()
	writeRaw(b, []rune("xxxxxxxxxxxxxxxxxxxx")...)
	lines := b.GetVisibleLines()
	assert.Equal(t, "", lines[0].String())
	assert.Equal(t, "xxxxxxxxxxxxxxxxxxxx", lines[1].String())
}

func TestCarriageReturnOnWrappedLine(t *testing.T) {
	b := makeBufferForTesting(80, 6)
	writeRaw(b, []rune("hello!")...)
	b.carriageReturn()
	writeRaw(b, []rune("secret")...)

	lines := b.GetVisibleLines()
	assert.Equal(t, "secret", lines[0].String())
}

func TestCarriageReturnOnLineThatDoesntExist(t *testing.T) {
	b := makeBufferForTesting(6, 10)
	b.cursorPosition.Line = 3
	b.carriageReturn()
	assert.Equal(t, uint16(0), b.cursorPosition.Col)
	assert.Equal(t, uint64(3), b.cursorPosition.Line)
}

func TestGetCell(t *testing.T) {
	b := makeBufferForTesting(80, 20)
	writeRaw(b, []rune("Hello")...)
	b.carriageReturn()
	b.newLine()

	writeRaw(b, []rune("there")...)
	b.carriageReturn()
	b.newLine()

	writeRaw(b, []rune("something...")...)
	cell := b.GetCell(8, 2)
	require.NotNil(t, cell)
	assert.Equal(t, 'g', cell.Rune().Rune)
}

func TestGetCellWithHistory(t *testing.T) {
	b := makeBufferForTesting(80, 2)

	writeRaw(b, []rune("Hello")...)
	b.carriageReturn()
	b.newLine()

	writeRaw(b, []rune("there")...)
	b.carriageReturn()
	b.newLine()

	writeRaw(b, []rune("something...")...)

	cell := b.GetCell(8, 1)
	require.NotNil(t, cell)
	assert.Equal(t, 'g', cell.Rune().Rune)
}

func TestGetCellWithBadCursor(t *testing.T) {
	b := makeBufferForTesting(80, 2)
	writeRaw(b, []rune("Hello\r\nthere\r\nsomething...")...)
	require.Nil(t, b.GetCell(8, 3))
	require.Nil(t, b.GetCell(90, 0))

}

func TestCursorPositionQuerying(t *testing.T) {
	b := makeBufferForTesting(80, 20)
	b.cursorPosition.Col = 17
	b.cursorPosition.Line = 9
	assert.Equal(t, b.cursorPosition.Col, b.CursorColumn())
	assert.Equal(t, b.convertRawLineToViewLine(b.cursorPosition.Line), b.CursorLine())
}

// CSI 2 K
func TestEraseLine(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello, this is a test")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("this line should be deleted")...)
	b.eraseLine()
	assert.Equal(t, "hello, this is a test", b.lines[0].String())
	assert.Equal(t, "", b.lines[1].String())
}

// CSI 1 K
func TestEraseLineToCursor(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello, this is a test")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("deleted")...)

	b.movePosition(-3, 0)
	b.eraseLineToCursor()
	assert.Equal(t, "hello, this is a test", b.lines[0].String())
	assert.Equal(t, "\x00\x00\x00\x00\x00ed", b.lines[1].String())
}

// CSI 0 K
func TestEraseLineAfterCursor(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello, this is a test")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("deleted")...)
	b.movePosition(-3, 0)
	b.eraseLineFromCursor()
	assert.Equal(t, "hello, this is a test", b.lines[0].String())
	assert.Equal(t, "dele", b.lines[1].String())
}
func TestEraseDisplay(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("asdasd")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("thing")...)
	b.movePosition(2, 1)
	b.eraseDisplay()
	lines := b.GetVisibleLines()
	for _, line := range lines {
		assert.Equal(t, "", line.String())
	}
}
func TestEraseDisplayToCursor(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("asdasd")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("thing")...)
	b.movePosition(-2, 0)
	b.eraseDisplayToCursor()
	lines := b.GetVisibleLines()
	assert.Equal(t, "", lines[0].String())
	assert.Equal(t, "", lines[1].String())
	assert.Equal(t, "\x00\x00\x00\x00g", lines[2].String())

}

func TestEraseDisplayFromCursor(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("asdasd")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("things")...)
	b.movePosition(-3, -1)
	b.eraseDisplayFromCursor()
	lines := b.GetVisibleLines()
	assert.Equal(t, "hello", lines[0].String())
	assert.Equal(t, "asd", lines[1].String())
	assert.Equal(t, "", lines[2].String())
}
func TestBackspace(t *testing.T) {
	b := makeBufferForTesting(80, 5)
	writeRaw(b, []rune("hello")...)
	b.backspace()
	b.backspace()
	writeRaw(b, []rune("p")...)
	lines := b.GetVisibleLines()
	assert.Equal(t, "helpo", lines[0].String())
}

func TestHorizontalResizeView(t *testing.T) {
	b := makeBufferForTesting(80, 10)

	// 60 characters
	writeRaw(b, []rune(`hellohellohellohellohellohellohellohellohellohellohellohello`)...)

	b.carriageReturn()
	b.newLine()

	writeRaw(b, []rune(`goodbyegoodbye`)...)

	require.Equal(t, uint16(14), b.cursorPosition.Col)
	require.Equal(t, uint64(1), b.cursorPosition.Line)

	b.resizeView(40, 10)

	expected := `hellohellohellohellohellohellohellohello
hellohellohellohello
goodbyegoodbye`

	require.Equal(t, uint16(14), b.cursorPosition.Col)
	require.Equal(t, uint64(2), b.cursorPosition.Line)

	lines := b.GetVisibleLines()
	strs := []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))

	b.resizeView(20, 10)

	expected = `hellohellohellohello
hellohellohellohello
hellohellohellohello
goodbyegoodbye`

	lines = b.GetVisibleLines()
	strs = []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))

	b.resizeView(10, 10)

	expected = `hellohello
hellohello
hellohello
hellohello
hellohello
hellohello
goodbyegoo
dbye`

	lines = b.GetVisibleLines()
	strs = []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))

	b.resizeView(80, 20)

	expected = `hellohellohellohellohellohellohellohellohellohellohellohello
goodbyegoodbye`

	lines = b.GetVisibleLines()
	strs = []string{}
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))

	require.Equal(t, uint16(4), b.cursorPosition.Col)
	require.Equal(t, uint64(1), b.cursorPosition.Line)

}

func TestBufferMaxLines(t *testing.T) {
	b := NewBuffer(80, 2, 2, color.White, color.Black)
	b.modes.LineFeedMode = false

	writeRaw(b, []rune("hello")...)
	b.newLine()
	writeRaw(b, []rune("funny")...)
	b.newLine()
	writeRaw(b, []rune("world")...)

	assert.Equal(t, 2, len(b.lines))
	assert.Equal(t, "funny", b.lines[0].String())
	assert.Equal(t, "world", b.lines[1].String())
}

func TestShrinkingThenGrowing(t *testing.T) {
	b := makeBufferForTesting(30, 100)
	writeRaw(b, []rune("hellohellohellohellohello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("01234567890123456789")...)
	b.carriageReturn()
	b.newLine()

	b.resizeView(25, 100)
	b.resizeView(24, 100)

	b.resizeView(30, 100)

	expected := `hellohellohellohellohello
01234567890123456789
`
	lines := b.GetVisibleLines()
	var strs []string
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))
}

func TestShrinkingThenRestoring(t *testing.T) {
	b := makeBufferForTesting(30, 100)
	writeRaw(b, []rune("hellohellohellohellohello")...)
	b.carriageReturn()
	b.newLine()
	writeRaw(b, []rune("01234567890123456789")...)
	b.carriageReturn()
	b.newLine()

	b.cursorPosition.Line = 2

	for i := uint16(29); i > 5; i-- {
		b.resizeView(i, 100)
	}

	for i := uint16(15); i < 30; i++ {
		b.resizeView(i, 100)
	}

	expected := `hellohellohellohellohello
01234567890123456789
`
	lines := b.GetVisibleLines()
	var strs []string
	for _, l := range lines {
		strs = append(strs, l.String())
	}
	require.Equal(t, expected, strings.Join(strs, "\n"))
}

func makeBufferForTesting(cols, rows uint16) *Buffer {
	return NewBuffer(cols, rows, 100, color.White, color.Black)
}
