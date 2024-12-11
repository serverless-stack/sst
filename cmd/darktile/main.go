package main

import (
	"fmt"
	"image/color"
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss"
	"github.com/sst/ion/cmd/darktile/termutil"
)

type model struct {
	term   *termutil.Terminal
	scroll int
}

type InitMsg struct{}
type UpdateMsg struct{}

func (m model) Init() (tea.Model, tea.Cmd) {
	updates := make(chan struct{})
	m.term = termutil.New(
		termutil.WithInitialCommand("btop"),
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
				row += lipgloss.NewStyle().
					Foreground(convert(cell.Fg())).
					Background(convert(cell.Bg())).
					Render(string(cell.Rune().Rune))
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
		return lipgloss.NoColor{}
	}
	r, g, b, _ := input.RGBA()
	hex := fmt.Sprintf("#%02x%02x%02x", r>>8, g>>8, b>>8)
	return lipgloss.Color(hex)
}

func main() {
	if _, err := tea.NewProgram(model{}, tea.WithAltScreen(), tea.WithFerociousRenderer()).Run(); err != nil {
		fmt.Println("Error running program:", err)
	}
}
