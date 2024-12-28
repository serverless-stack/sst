package main

import (
	"fmt"
	"image/color"
	"log/slog"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss"
	"github.com/sst/sst/v3/cmd/darktile/termutil"
)

type model struct {
	term   *termutil.Terminal
	scroll int
}

type InitMsg struct{}
type UpdateMsg struct{}

func (m model) Init() (tea.Model, tea.Cmd) {
	updates := make(chan struct{})
	os.Setenv("SST_SERVER", "http://localhost:13557")
	m.term = termutil.New(
		termutil.WithShell(`nvim`),
	)
	go m.term.Run(updates, 100, 100)
	return m, func() tea.Msg { return UpdateMsg{} }
}
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case UpdateMsg:
		return m, func() tea.Msg {
			return UpdateMsg{}
		}
	case tea.WindowSizeMsg:
		if m.term == nil {
			return m, nil
		}
		m.term.SetSize(uint16(msg.Height), uint16(msg.Width))
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		case "ctrl+u":
			if m.scroll == 0 {
				m.scroll = m.term.GetActiveBuffer().Height() - 1
				return m, nil
			}
			m.scroll--
			return m, nil
		case "ctrl+d":
			if m.scroll == 0 {
				m.scroll = m.term.GetActiveBuffer().Height() + 1
				return m, nil
			}
			m.scroll++
			return m, nil

		default:
			m.term.WriteToPty(KeyMsgToANSI(msg))
		}
	}
	return m, nil
}
func (m model) View() string {
	if m.term == nil {
		return ""
	}
	buf := m.term.GetActiveBuffer()
	if m.scroll > 0 {
		buf.SetScrollOffset(uint(buf.Height()) - uint(m.scroll))
	}
	out := []string{}
	for y := uint16(0); y < uint16(buf.Height()); y++ {
		row := ""
		for x := uint16(0); x < buf.Width(); x++ {
			cell := buf.GetCell(x, y)
			if cell != nil {
				style := lipgloss.NewStyle().Foreground(cell.Fg()).Background(cell.Bg())
				row += style.Render(string(cell.Rune().Rune))

			} else {
				row += " "
			}
		}
		out = append(out, row)
	}
	out = append(out, fmt.Sprintf("width: %d, scroll: %d height: %d", buf.Width(), m.scroll, buf.Height()))
	return strings.Join(out, "\n")
}

func convert(input color.Color) lipgloss.TerminalColor {
	if input == nil {
		return lipgloss.Color("#FF0000")
	}
	r, g, b, _ := input.RGBA()
	hex := fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, b>>8)
	return lipgloss.Color(hex)
}

func main() {
	logFile, err := os.Create("darktile.log")
	if err != nil {
		panic(err)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(logFile, nil)))
	if _, err := tea.NewProgram(model{}, tea.WithAltScreen(), tea.WithFerociousRenderer()).Run(); err != nil {
		fmt.Println("Error running program:", err)
	}
}

func KeyMsgToANSI(msg tea.KeyMsg) []byte {
	str := msg.String()

	// Handle ctrl keys
	if strings.HasPrefix(str, "ctrl+") {
		ch := strings.ToUpper(strings.TrimPrefix(str, "ctrl+"))[0]
		return []byte{byte(ch) - 64} // Convert to control character (1-26)
	}

	// Handle special keys
	switch str {
	case "up":
		return []byte("\x1b[A")
	case "down":
		return []byte("\x1b[B")
	case "right":
		return []byte("\x1b[C")
	case "left":
		return []byte("\x1b[D")
	case "enter":
		return []byte("\r")
	case "tab":
		return []byte("\t")
	case "space":
		return []byte(" ")
	case "esc":
		return []byte("\x1b")
	case "backspace":
		return []byte("\x7f")
	case "delete":
		return []byte("\x1b[3~")
	}

	// Handle alt+key combinations
	if strings.HasPrefix(str, "alt+") {
		key := strings.TrimPrefix(str, "alt+")
		if len(key) == 1 {
			return []byte{0x1b, key[0]}
		}
	}

	// Handle single characters
	if len(str) == 1 {
		return []byte(str)
	}

	// Fallback for unknown keys
	return []byte{}
}
