package socket

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/gorilla/websocket"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/project"
	"github.com/sst/sst/v3/pkg/server"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type CliDevEvent struct {
	App    string `json:"app"`
	Stage  string `json:"stage"`
	Region string `json:"region"`
}

type Invocation struct {
	ID     string            `json:"id,omitempty"`
	Source string            `json:"source,omitempty"`
	Cold   bool              `json:"cold,omitempty"`
	Input  json.RawMessage   `json:"input,omitempty"`
	Output interface{}       `json:"output,omitempty"`
	Start  int64             `json:"start,omitempty"`
	End    int64             `json:"end,omitempty"`
	Errors []InvocationError `json:"errors"`
	Logs   []InvocationLog   `json:"logs"`
	Report *InvocationReport `json:"report,omitempty"`
}

type InvocationLog struct {
	ID        string `json:"id,omitempty"`
	Timestamp int64  `json:"timestamp,omitempty"`
	Message   string `json:"message,omitempty"`
}

type InvocationReport struct {
	Duration int64  `json:"duration"`
	Init     int64  `json:"init"`
	Size     int64  `json:"size"`
	Memory   int64  `json:"memory"`
	Xray     string `json:"xray"`
}

type InvocationError struct {
	ID      string  `json:"id"`
	Error   string  `json:"error"`
	Message string  `json:"message"`
	Stack   []Frame `json:"stack"`
	Failed  bool    `json:"failed"`
}

type Frame struct {
	Raw string `json:"raw"`
}

func Start(ctx context.Context, p *project.Project, server *server.Server) error {
	connected := make(chan *websocket.Conn)
	disconnected := make(chan *websocket.Conn)
	invocationClear := make(chan string)
	server.Mux.HandleFunc("/socket", func(w http.ResponseWriter, r *http.Request) {
		slog.Info("socket upgrading", "addr", r.RemoteAddr)
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()

		connected <- ws
		defer func() {
			disconnected <- ws
		}()

		for {
			_, data, err := ws.ReadMessage()
			if err != nil {
				slog.Info("socket error", "err", err)
				break
			}

			slog.Info("socket message", "message", string(data))
			var message map[string]interface{}
			err = json.Unmarshal(data, &message)
			if err != nil {
				continue
			}

			if message["type"] == "log.cleared" {
				source := message["properties"].(map[string]interface{})["source"].(string)
				invocationClear <- source
			}

		}
	})
	sockets := make(map[*websocket.Conn]struct{})
	invocations := make(map[string]*Invocation)

	evts := bus.SubscribeAll()

	publish := func(evt interface{}) {
		for ws := range sockets {
			ws.WriteJSON(evt)
		}
	}

	publishInvocation := func(invocation *Invocation) {
		publish(map[string]interface{}{
			"type": "invocation",
			"properties": []*Invocation{
				invocation,
			},
		})
	}

	var complete *project.CompleteEvent

	for {
		select {
		case <-ctx.Done():
			return nil
		case source := <-invocationClear:
			if source == "all" {
				invocations = map[string]*Invocation{}
				break
			}
			for id, invocation := range invocations {
				if invocation.Source == source {
					delete(invocations, id)
				}
			}
			break

		case unknown := <-evts:
			switch evt := unknown.(type) {
			case *project.CompleteEvent:
				complete = evt
				break
			case *aws.FunctionInvokedEvent:
				source := ""
				if complete != nil {
					for _, resource := range complete.Resources {
						if resource.URN.Name() == evt.FunctionID && resource.Type == "sst:aws:Function" {
							source = string(resource.URN)
						}
					}
				}
				invocation := &Invocation{
					ID:     evt.RequestID,
					Source: source,
					Input:  json.RawMessage(evt.Input),
					Start:  time.Now().UnixMilli(),
					Errors: []InvocationError{},
					Logs:   []InvocationLog{},
				}
				invocations[evt.RequestID] = invocation
				publishInvocation(invocation)
				break
			case *aws.FunctionResponseEvent:
				invocation, ok := invocations[evt.RequestID]
				if ok {
					invocation.Output = json.RawMessage(evt.Output)
					invocation.End = time.Now().UnixMilli()
					invocation.Report = &InvocationReport{
						Duration: invocation.End - invocation.Start,
					}
					publishInvocation(invocation)
				}
				break
			case *aws.FunctionErrorEvent:
				invocation, ok := invocations[evt.RequestID]
				if ok {
					invocation.End = time.Now().UnixMilli()
					invocation.Report = &InvocationReport{
						Duration: invocation.End - invocation.Start,
					}
					error := InvocationError{
						Message: evt.ErrorMessage,
						Error:   evt.ErrorType,
						Failed:  true,
						Stack:   []Frame{},
					}
					for _, frame := range evt.Trace {
						error.Stack = append(error.Stack, Frame{
							Raw: frame,
						})
					}
					invocation.Errors = append(invocation.Errors, error)
					publishInvocation(invocation)
				}
				break
			case *aws.FunctionLogEvent:
				invocation, ok := invocations[evt.RequestID]
				if ok {
					invocation.Logs = append(invocation.Logs, InvocationLog{
						ID:        time.Now().String(),
						Timestamp: time.Now().UnixMilli(),
						Message:   ansi.Strip(evt.Line),
					})
					publishInvocation(invocation)
				}
				break
			}
		case ws := <-connected:
			slog.Info("socket connected", "addr", ws.RemoteAddr())
			sockets[ws] = struct{}{}
			ws.WriteJSON(map[string]interface{}{
				"type": "cli.dev",
				"properties": CliDevEvent{
					App:   p.App().Name,
					Stage: p.App().Stage,
				},
			})
			all := []*Invocation{}
			for _, invocation := range invocations {
				all = append(all, invocation)
			}
			slog.Info("sending invocations", "count", len(all))
			ws.WriteJSON(map[string]interface{}{
				"type":       "invocation",
				"properties": all,
			})
			break
		case ws := <-disconnected:
			slog.Info("socket disconnected", "addr", ws.RemoteAddr())
			delete(sockets, ws)
			break
		}
	}

}
