package tcellterm

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime/debug"
	"strings"
	"sync"
	"unicode"

	"github.com/creack/pty"
	"github.com/gdamore/tcell/v2"
	"github.com/mattn/go-runewidth"
	"github.com/sst/sst/v3/pkg/process"
)

type (
	column int
	row    int
)

// VT models a virtual terminal
type VT struct {
	Logger *log.Logger
	// If true, OSC8 enables the output of OSC8 strings. Otherwise, any OSC8
	// sequences will be stripped
	OSC8 bool
	// Set the TERM environment variable to be passed to the command's
	// environment. If not set, xterm-256color will be used
	TERM string

	mu sync.Mutex

	activeScreen      [][]cell
	altScreen         [][]cell
	primaryScreen     [][]cell
	primaryScrollback [][]cell

	scroll int

	charsets charsets
	cursor   cursor
	margin   margin
	mode     mode
	sShift   charset
	tabStop  []column
	// lastCol is a flag indicating we printed in the last col
	lastCol bool

	primaryState cursorState
	altState     cursorState

	cmd          *exec.Cmd
	dirty        bool
	eventHandler func(tcell.Event)
	parser       *Parser
	pty          *os.File
	surface      Surface
	events       chan tcell.Event

	mouseBtn tcell.ButtonMask

	selection *selection
}

type selection struct {
	content strings.Builder
	startX  int
	startY  int
	endX    int
	endY    int
}

type cursorState struct {
	cursor   cursor
	decawm   bool
	decom    bool
	charsets charsets
}

type margin struct {
	top    row
	bottom row
	left   column
	right  column
}

func New() *VT {
	tabs := []column{}
	for i := 7; i < (50 * 7); i += 8 {
		tabs = append(tabs, column(i))
	}
	return &VT{
		Logger: log.New(io.Discard, "", log.Flags()),
		OSC8:   true,
		scroll: -1,
		selection: &selection{
			startX: 0,
			startY: 0,
			endX:   -1,
			endY:   -1,
		},
		charsets: charsets{
			designations: map[charsetDesignator]charset{
				g0: ascii,
				g1: ascii,
				g2: ascii,
				g3: ascii,
			},
		},
		mode: decawm | dectcem,
		primaryState: cursorState{
			charsets: charsets{
				designations: map[charsetDesignator]charset{
					g0: ascii,
					g1: ascii,
					g2: ascii,
					g3: ascii,
				},
			},
			decawm: true,
		},
		altState: cursorState{
			charsets: charsets{
				designations: map[charsetDesignator]charset{
					g0: ascii,
					g1: ascii,
					g2: ascii,
					g3: ascii,
				},
			},
			decawm: true,
		},
		tabStop:      tabs,
		eventHandler: func(ev tcell.Event) { return },
		// Buffering to 2 events. If there is ever a case where one
		// sequence can trigger two events, this should be increased
		events: make(chan tcell.Event, 2),
	}
}

// Start starts the terminal with the specified command. Start returns when the
// command has been successfully started.
func (vt *VT) Start(cmd *exec.Cmd) error {
	if cmd == nil {
		return fmt.Errorf("no command to run")
	}
	vt.cmd = cmd
	vt.mu.Lock()
	w, h := vt.surface.Size()
	vt.mu.Unlock()

	if vt.TERM == "" {
		vt.TERM = "xterm-256color"
	}

	cmd.Env = append(cmd.Env, "TERM="+vt.TERM)

	// Start the command with a pty.
	var err error
	winsize := pty.Winsize{
		Cols: uint16(w),
		Rows: uint16(h),
	}
	vt.pty, err = pty.StartWithAttrs(cmd, &winsize, getPtyAttr())
	if err != nil {
		return err
	}

	vt.Resize(w, h)
	vt.parser = NewParser(vt.pty)
	go func() {
		defer vt.recover()
		for {
			select {
			case ev := <-vt.events:
				vt.eventHandler(ev)
			default:
				seq := vt.parser.Next()
				switch seq := seq.(type) {
				case EOF:
					vt.eventHandler(&EventClosed{
						EventTerminal: newEventTerminal(vt),
					})
					return
				default:
					vt.update(seq)
				}
			}
		}
	}()
	return nil
}

func (vt *VT) update(seq Sequence) {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	switch seq := seq.(type) {
	case Print:
		vt.print(rune(seq))
	case C0:
		vt.c0(rune(seq))
	case ESC:
		esc := append(seq.Intermediate, seq.Final)
		vt.esc(string(esc))
	case CSI:
		csi := append(seq.Intermediate, seq.Final)
		vt.csi(string(csi), seq.Parameters)
	case OSC:
		vt.osc(string(seq.Payload))
	case DCS:
	case DCSData:
	case DCSEndOfData:
	}
	// TODO optimize when we post EventRedraw
	if !vt.dirty {
		vt.dirty = true
		vt.postEvent(&EventRedraw{
			EventTerminal: newEventTerminal(vt),
		})
	}
}

func (vt *VT) String() string {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	str := strings.Builder{}
	for row := range vt.activeScreen {
		for col := range vt.activeScreen[row] {
			_, _ = str.WriteRune(vt.activeScreen[row][col].rune())
			for _, comb := range vt.activeScreen[row][col].combining {
				_, _ = str.WriteRune(comb)
			}
		}
		if row < vt.height()-1 {
			str.WriteRune('\n')
		}
	}
	return str.String()
}

func (vt *VT) recover() {
	err := recover()
	if err == nil {
		return
	}
	ret := strings.Builder{}
	ret.WriteString(fmt.Sprintf("cursor row=%d col=%d\n", vt.cursor.row, vt.cursor.col))
	ret.WriteString(fmt.Sprintf("margin left=%d right=%d\n", vt.margin.left, vt.margin.right))
	ret.WriteString(fmt.Sprintf("%s\n", err))
	ret.Write(debug.Stack())

	vt.postEvent(&EventPanic{
		EventTerminal: newEventTerminal(vt),
		Error:         fmt.Errorf(ret.String()),
	})
	vt.Close()
}

// row, col, style, vis
func (vt *VT) Cursor() (int, int, tcell.CursorStyle, bool) {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vis := vt.mode&dectcem > 0
	return int(vt.cursor.row), int(vt.cursor.col), vt.cursor.style, vis
}

func (vt *VT) Resize(w int, h int) {
	primary := vt.primaryScreen
	vt.altScreen = make([][]cell, h)
	vt.primaryScreen = make([][]cell, h)
	for i := range vt.altScreen {
		vt.altScreen[i] = make([]cell, w)
		vt.primaryScreen[i] = make([]cell, w)
	}
	last := vt.cursor.row
	vt.margin.bottom = row(h) - 1
	vt.margin.right = column(w) - 1
	vt.cursor.row = 0
	vt.cursor.col = 0
	vt.lastCol = false
	vt.activeScreen = vt.primaryScreen

	// transfer primary to new, skipping the last row
	for row := 0; row < len(primary); row += 1 {
		if row == int(last) {
			break
		}
		wrapped := false
		for col := 0; col < len(primary[0]); col += 1 {
			cell := primary[row][col]
			vt.cursor.attrs = cell.attrs
			vt.print(cell.content)
			wrapped = cell.wrapped
		}
		if !wrapped {
			vt.nel()
		}
	}
	switch vt.mode & smcup {
	case 0:
		vt.activeScreen = vt.primaryScreen
	default:
		vt.activeScreen = vt.altScreen
	}
	/*
		nextScrollback := [][]cell{}
		currentRow := []cell{}
		for _, row := range vt.primaryScrollback {
			for col, c := range row {
				if col >= w {
					nextScrollback = append(nextScrollback, currentRow)
					currentRow = []cell{}
				}
				currentRow = append(currentRow, c)
			}
		}
		vt.primaryScrollback = nextScrollback
	*/

	_ = pty.Setsize(vt.pty, &pty.Winsize{
		Cols: uint16(w),
		Rows: uint16(h),
	})
}

func (vt *VT) width() int {
	if len(vt.activeScreen) > 0 {
		return len(vt.activeScreen[0])
	}
	return 0
}

func (vt *VT) height() int {
	return len(vt.activeScreen)
}

// print sets the current cell contents to the given rune. The attributes will
// be copied from the current cursor attributes
func (vt *VT) print(r rune) {
	if vt.charsets.designations[vt.charsets.selected] == decSpecialAndLineDrawing {
		shifted, ok := decSpecial[r]
		if ok {
			r = shifted
		}
	}

	// If we are single-shifted, move the previous charset into the current
	if vt.charsets.singleShift {
		vt.charsets.selected = vt.charsets.saved
	}

	if vt.cursor.col == vt.margin.right && vt.lastCol {
		col := vt.cursor.col
		rw := vt.cursor.row
		vt.activeScreen[rw][col].wrapped = true
		vt.nel()
	}

	col := vt.cursor.col
	rw := vt.cursor.row
	w := runewidth.RuneWidth(r)

	if vt.mode&irm != 0 {
		line := vt.activeScreen[rw]
		for i := vt.margin.right; i > col; i -= 1 {
			line[i] = line[i-column(w)]
		}
	}
	if col > column(vt.width())-1 {
		col = column(vt.width()) - 1
	}
	if rw > row(vt.height()-1) {
		rw = row(vt.height() - 1)
	}

	if w == 0 {
		if col-1 < 0 {
			return
		}
		vt.activeScreen[rw][col-1].combining = append(vt.activeScreen[rw][col-1].combining, r)
		return
	}
	cell := cell{
		content: r,
		width:   w,
		attrs:   vt.cursor.attrs,
	}

	vt.activeScreen[rw][col] = cell

	// Set trailing cells to a space if wide rune
	for i := column(1); i < column(w); i += 1 {
		if col+i > vt.margin.right {
			break
		}
		vt.activeScreen[rw][col+i].content = ' '
		vt.activeScreen[rw][col+i].attrs = vt.cursor.attrs
	}

	switch {
	case vt.mode&decawm != 0 && col == vt.margin.right:
		vt.lastCol = true
	case col == vt.margin.right:
		// don't move the cursor
	default:
		vt.cursor.col += column(w)
	}
}

// scrollUp shifts all text upward by n rows. Semantically, this is backwards -
// usually scroll up would mean you shift rows down
func (vt *VT) scrollUp(n int) {
	for i := 0; i < n; i += 1 {
		history := make([]cell, len(vt.activeScreen[i]))
		copy(history, vt.activeScreen[i])
		vt.primaryScrollback = append(vt.primaryScrollback, history)
	}
	for row := range vt.activeScreen {
		if row > int(vt.margin.bottom) {
			continue
		}
		if row < int(vt.margin.top) {
			continue
		}
		if row+n > int(vt.margin.bottom) {
			for col := vt.margin.left; col <= vt.margin.right; col += 1 {
				vt.activeScreen[row][col].erase(vt.cursor.attrs)
			}
			continue
		}
		copy(vt.activeScreen[row], vt.activeScreen[row+n])
	}
}

// scrollDown shifts all lines down by n rows.
func (vt *VT) scrollDown(n int) {
	for r := vt.margin.bottom; r >= vt.margin.top; r -= 1 {
		if r-row(n) < vt.margin.top {
			for col := vt.margin.left; col <= vt.margin.right; col += 1 {
				vt.activeScreen[r][col].erase(vt.cursor.attrs)
			}
			continue
		}
		copy(vt.activeScreen[r], vt.activeScreen[r-row(n)])
	}
}

func (vt *VT) Close() {
	if vt.cmd != nil && vt.cmd.Process != nil {
		process.Kill(vt.cmd.Process)
	}
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vt.pty.Close()
}

func (vt *VT) Attach(fn func(ev tcell.Event)) {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vt.eventHandler = fn
}

func (vt *VT) Detach() {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vt.eventHandler = func(ev tcell.Event) {
		return
	}
}

func (vt *VT) postEvent(ev tcell.Event) {
	vt.events <- ev
}

func (vt *VT) SetSurface(srf Surface) {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vt.surface = srf
}

func (vt *VT) ScrollUp(offset int) {
	if !vt.IsScrolling() {
		if len(vt.primaryScrollback) == 0 {
			return
		}
		vt.scroll = len(vt.primaryScrollback)
	}
	vt.scroll = vt.scroll - offset
	vt.scroll = max(0, vt.scroll)
}

func (vt *VT) ScrollDown(offset int) {
	if !vt.IsScrolling() {
		return
	}
	vt.scroll = vt.scroll + offset
	if vt.scroll >= len(vt.primaryScrollback) {
		vt.ScrollReset()
	}
}

func (vt *VT) ScrollReset() {
	vt.scroll = -1
}

func (vt *VT) Scrollable() bool {
	return len(vt.primaryScrollback) > 0
}

func (vt *VT) IsScrolling() bool {
	return vt.scroll != -1
}

func (vt *VT) Draw() {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	vt.dirty = false
	if vt.surface == nil {
		return
	}
	offset := 0
	vt.selection.content = strings.Builder{}
	if vt.IsScrolling() {
		for x := vt.scroll; x < len(vt.primaryScrollback); x += 1 {
			if offset >= vt.height() {
				break
			}
			vt.drawRow(offset, vt.primaryScrollback[x])
			offset += 1
		}
	}
	for cols := range vt.activeScreen {
		if offset >= vt.height() {
			break
		}
		vt.drawRow(offset, vt.activeScreen[cols])
		offset++
	}
}

func (vt *VT) drawRow(row int, cols []cell) {
	scrollOffset := len(vt.primaryScrollback)
	if vt.scroll != -1 {
		scrollOffset = vt.scroll
	}
	builder := strings.Builder{}
	for col := 0; col < len(cols); {
		cell := cols[col]
		w := cell.width
		content := cell.content
		if cell.content == '\x00' {
			content = ' '
			w = 1
		}
		style := cell.attrs
		if vt.selection != nil && isCellSelected(col, row+scrollOffset, vt.selection.startX, vt.selection.startY, vt.selection.endX, vt.selection.endY) {
			style = style.Reverse(true)
			builder.WriteRune(content)
		}
		vt.surface.SetContent(col, row, content, cell.combining, style)
		if w == 0 {
			w = 1
		}
		col += 1
	}
	if builder.Len() > 0 {
		vt.selection.content.WriteString(strings.TrimRight(builder.String(), " "))
		vt.selection.content.WriteRune('\n')
	}
}

func (vt *VT) HandleEvent(e tcell.Event) bool {
	vt.mu.Lock()
	defer vt.mu.Unlock()
	switch e := e.(type) {
	case *tcell.EventKey:
		vt.pty.WriteString(keyCode(e))
		return true
	case *tcell.EventPaste:
		switch {
		case vt.mode&paste == 0:
			return false
		case e.Start():
			vt.pty.WriteString(info.PasteStart)
			return true
		case e.End():
			vt.pty.WriteString(info.PasteEnd)
			return true
		}
	case *tcell.EventMouse:
		str := vt.handleMouse(e)
		vt.pty.WriteString(str)
	}
	return false
}

func (vt *VT) Clear() {
	vt.ris()
}

func (vt *VT) Copy() string {
	return strings.TrimRightFunc(vt.selection.content.String(), unicode.IsSpace)
}

func (vt *VT) SelectStart(x int, y int) {
	scrollOffset := len(vt.primaryScrollback)
	if vt.scroll != -1 {
		scrollOffset = vt.scroll
	}
	y += scrollOffset
	vt.selection = &selection{
		startX: x,
		startY: y,
		endX:   -1,
		endY:   -1,
	}
}

func (vt *VT) SelectEnd(x int, y int) {
	scrollOffset := len(vt.primaryScrollback)
	if vt.scroll != -1 {
		scrollOffset = vt.scroll
	}
	y += scrollOffset
	vt.selection.endX = x
	vt.selection.endY = y
}

func (vt *VT) HasSelection() bool {
	return vt.selection.endX != -1 && vt.selection.endY != -1
}

func (vt *VT) ClearSelection() {
	vt.selection.startX = 0
	vt.selection.startY = 0
	vt.selection.endX = -1
	vt.selection.endY = -1
}

func isCellSelected(x, y, startX, startY, endX, endY int) bool {
	if endX < 0 || endY < 0 {
		return false
	}
	// Normalize the selection coordinates
	minY, maxY := startY, endY
	minX, maxX := startX, endX
	if endY < startY || endY == startY && endX < startX {
		minY, maxY = endY, startY
		minX, maxX = endX, startX
	}
	// Check if the cell is within the selection
	if y > minY && y < maxY {
		return true // Full line selected
	}
	if y == minY && y == maxY {
		return x >= minX && x <= maxX // Single line selection
	}
	if y == minY {
		return x >= minX // First line of multi-line selection
	}
	if y == maxY {
		return x <= maxX // Last line of multi-line selection
	}
	return false
}
