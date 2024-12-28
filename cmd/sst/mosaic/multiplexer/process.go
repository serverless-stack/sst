package multiplexer

import (
	"os/exec"

	"github.com/gdamore/tcell/v2"
	tcellterm "github.com/sst/sst/v3/cmd/sst/mosaic/multiplexer/tcell-term"
	"github.com/sst/sst/v3/pkg/process"
)

type vterm struct {
	Resize func(int, int)
	Start  func(cmd *exec.Cmd) error
}

type pane struct {
	icon     string
	key      string
	args     []string
	title    string
	dir      string
	killable bool
	env      []string
	vt       *tcellterm.VT
	dead     bool
	cmd      *exec.Cmd
}

type EventProcess struct {
	tcell.EventTime
	Key       string
	Args      []string
	Icon      string
	Title     string
	Cwd       string
	Killable  bool
	Autostart bool
	Env       []string
}

func (s *Multiplexer) AddProcess(key string, args []string, icon string, title string, cwd string, killable bool, autostart bool, env ...string) {
	s.screen.PostEvent(&EventProcess{
		Key:       key,
		Args:      args,
		Icon:      icon,
		Title:     title,
		Cwd:       cwd,
		Killable:  killable,
		Autostart: autostart,
		Env:       env,
	})
}

func (p *pane) start() error {
	p.cmd = process.Command(p.args[0], p.args[1:]...)
	p.cmd.Env = p.env
	if p.dir != "" {
		p.cmd.Dir = p.dir
	}
	p.vt.Clear()
	err := p.vt.Start(p.cmd)
	if err != nil {
		return err
	}
	p.dead = false
	return nil
}

func (p *pane) Kill() {
	p.vt.Close()
}

func (s *pane) scrollUp(offset int) {
	s.vt.ScrollUp(offset)
}

func (s *pane) scrollDown(offset int) {
	s.vt.ScrollDown(offset)
}

func (s *pane) scrollReset() {
	s.vt.ScrollReset()
}

func (s *pane) isScrolling() bool {
	return s.vt.IsScrolling()
}

func (s *pane) scrollable() bool {
	return s.vt.Scrollable()
}
