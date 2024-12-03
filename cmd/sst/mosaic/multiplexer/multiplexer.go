package multiplexer

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/gdamore/tcell/v2/views"
	tcellterm "github.com/sst/ion/cmd/sst/mosaic/multiplexer/tcell-term"
	"github.com/sst/ion/pkg/process"
)

var PAD_HEIGHT = 0
var PAD_WIDTH = 0
var SIDEBAR_WIDTH = 20

type Multiplexer struct {
	ctx       context.Context
	focused   bool
	width     int
	height    int
	selected  int
	processes []*pane
	screen    tcell.Screen
	root      *views.ViewPort
	main      *views.ViewPort
	stack     *views.BoxLayout

	dragging bool
	click    *tcell.EventMouse
}

func New(ctx context.Context) (*Multiplexer, error) {
	var err error
	result := &Multiplexer{}
	result.ctx = ctx
	result.processes = []*pane{}
	result.screen, err = tcell.NewScreen()
	if err != nil {
		return nil, err
	}
	result.screen.Init()
	result.screen.EnableMouse()
	result.screen.Show()
	width, height := result.screen.Size()
	result.width = width
	result.height = height
	result.root = views.NewViewPort(result.screen, 0, 0, 0, 0)
	result.main = views.NewViewPort(result.screen, 0, 0, 0, 0)
	result.stack = views.NewBoxLayout(views.Vertical)
	result.stack.SetView(result.root)
	if os.Getenv("TMUX") != "" {
		process.Command("tmux", "set-option", "-p", "set-clipboard", "on").Run()
	}
	return result, nil
}

func (s *Multiplexer) mainRect() (int, int) {
	return s.width - SIDEBAR_WIDTH + 1, s.height
}

func (s *Multiplexer) resize(width int, height int) {
	s.width = width
	s.height = height
	s.root.Resize(PAD_WIDTH, PAD_HEIGHT, SIDEBAR_WIDTH, height-PAD_HEIGHT*2)
	s.main.Resize(PAD_WIDTH+SIDEBAR_WIDTH+PAD_WIDTH+1, PAD_HEIGHT, width-PAD_WIDTH-SIDEBAR_WIDTH-PAD_WIDTH-PAD_WIDTH-1, height-PAD_HEIGHT*2)
	mw, mh := s.main.Size()
	for _, p := range s.processes {
		p.vt.Resize(mw, mh)
	}
}

func (s *Multiplexer) Start() {
	defer func() {
		// for _, p := range s.processes {
		// 	p.Kill()
		// }
		s.screen.Fini()
	}()

	s.resize(s.screen.Size())

	for {
		select {
		case <-s.ctx.Done():
			return
		default:
			unknown := s.screen.PollEvent()
			if unknown == nil {
				continue
			}
			shouldBreak := false
			func() {
				defer func() {
					if r := recover(); r != nil {
						slog.Error("mutliplexer panic", "err", r, "stack", string(debug.Stack()))
					}
				}()

				selected := s.selectedProcess()

				switch evt := unknown.(type) {

				case *EventProcess:
					for _, p := range s.processes {
						if p.key == evt.Key {
							return
						}
					}
					proc := &pane{
						icon:     evt.Icon,
						key:      evt.Key,
						dir:      evt.Cwd,
						title:    evt.Title,
						args:     evt.Args,
						killable: evt.Killable,
						env:      evt.Env,
						dead:     !evt.Autostart,
					}
					term := tcellterm.New()
					term.SetSurface(s.main)
					term.Attach(func(ev tcell.Event) {
						s.screen.PostEvent(ev)
					})
					proc.vt = term
					if evt.Autostart {
						proc.start()
					}
					if !evt.Autostart {
						proc.vt.Start(process.Command("echo", evt.Key+" has auto-start disabled, press enter to start."))
						proc.dead = true
					}
					s.processes = append(s.processes, proc)
					s.sort()
					s.draw()
					break

				case *tcell.EventMouse:
					if evt.Buttons()&tcell.WheelUp != 0 {
						s.scrollUp(3)
						return
					}
					if evt.Buttons()&tcell.WheelDown != 0 {
						s.scrollDown(3)
						return
					}
					if evt.Buttons() == tcell.ButtonNone {
						if s.dragging && selected != nil {
							s.copy()
						}
						s.dragging = false
						return
					}
					if evt.Buttons()&tcell.ButtonPrimary != 0 {
						x, y := evt.Position()
						if x < SIDEBAR_WIDTH && !s.dragging {
							alive := 0
							for _, p := range s.processes {
								if !p.dead {
									alive++
								}
							}
							if alive != len(s.processes) {
								if y == alive {
									return
								}
								if y > alive {
									y--
								}
							}
							if y >= len(s.processes) {
								return
							}
							s.selected = y
							s.blur()
							return
						}
						if x > SIDEBAR_WIDTH {
							if !s.dragging && s.click != nil && time.Since(s.click.When()) < time.Millisecond*500 {
								oldX, oldY := s.click.Position()
								if oldX == x && oldY == y {
									selected.vt.SelectStart(0, y)
									selected.vt.SelectEnd(s.width-1, y)
									s.dragging = true
									s.draw()
									return
								}
							}
							s.click = evt
							offsetX := x - SIDEBAR_WIDTH - 1
							if s.dragging {
								selected.vt.SelectEnd(offsetX, y)
							}
							if !s.dragging {
								s.dragging = true
								selected.vt.SelectStart(offsetX, y)
							}
							s.draw()
							return
						}
					}
					break

				case *tcell.EventResize:
					slog.Info("resize")
					s.resize(evt.Size())
					s.draw()
					s.screen.Sync()
					return

				case *tcellterm.EventRedraw:
					if selected != nil && selected.vt == evt.VT() {
						selected.vt.Draw()
						s.screen.Show()
					}
					return

				case *tcellterm.EventClosed:
					for index, proc := range s.processes {
						if proc.vt == evt.VT() {
							if !proc.dead {
								proc.vt.Start(process.Command("echo", "\n[process exited]"))
								proc.dead = true
								s.sort()
								if index == s.selected {
									s.blur()
								}
							}
						}
					}
					s.draw()
					return

				case *tcell.EventKey:
					switch evt.Key() {
					case 256:
						switch evt.Rune() {
						case 'j':
							if !s.focused {
								s.move(1)
								return
							}
						case 'k':
							if !s.focused {
								s.move(-1)
								return
							}
						case 'x':
							if selected.killable && !selected.dead && !s.focused {
								selected.Kill()
							}
						}
					case tcell.KeyUp:
						if !s.focused {
							s.move(-1)
							return
						}
					case tcell.KeyDown:
						if !s.focused {
							s.move(1)
							return
						}
					case tcell.KeyCtrlU:
						if selected != nil {
							s.scrollUp(s.height/2 + 1)
							return
						}
					case tcell.KeyCtrlD:
						if selected != nil {
							s.scrollDown(s.height/2 + 1)
							return
						}
					case tcell.KeyEnter:
						if selected != nil && selected.vt.HasSelection() {
							s.copy()
							selected.vt.ClearSelection()
							s.draw()
							return
						}
						if selected != nil && selected.isScrolling() && (s.focused || !selected.killable) {
							selected.scrollReset()
							s.draw()
							s.screen.Sync()
							return
						}
						if !s.focused {
							if selected.killable {
								if selected.dead {
									selected.start()
									s.sort()
									s.draw()
									return
								}
								s.focus()
							}
							return
						}
					case tcell.KeyCtrlC:
						if !s.focused {
							pid := os.Getpid()
							process, _ := os.FindProcess(pid)
							process.Signal(syscall.SIGINT)
							shouldBreak = true
							return
						}
					case tcell.KeyCtrlZ:
						if s.focused {
							s.blur()
							return
						}
					}

					if selected != nil && s.focused && !selected.isScrolling() {
						selected.vt.HandleEvent(evt)
						s.draw()
					}
				}
			}()
			if shouldBreak {
				return
			}
		}
	}
}

func (s *Multiplexer) scrollDown(n int) {
	selected := s.selectedProcess()
	if selected == nil {
		return
	}
	selected.scrollDown(n)
	s.draw()
	s.screen.Sync()
}

func (s *Multiplexer) scrollUp(n int) {
	selected := s.selectedProcess()
	if selected == nil {
		return
	}
	selected.scrollUp(n)
	s.draw()
}

func (s *Multiplexer) copy() {
	selected := s.selectedProcess()
	if selected == nil {
		return
	}
	data := selected.vt.Copy()
	if data == "" {
		return
	}
	// check if mac terminal
	if os.Getenv("TERM_PROGRAM") == "Apple_Terminal" {
		// use pbcopy
		cmd := process.Command("pbcopy")
		cmd.Stdin = strings.NewReader(data)
		err := cmd.Run()
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to copy to clipboard: %v\n", err)
		}
		return
	}
	encoded := base64.StdEncoding.EncodeToString([]byte(data))
	fmt.Fprintf(os.Stdout, "\x1b]52;c;%s\x07", encoded)
}
