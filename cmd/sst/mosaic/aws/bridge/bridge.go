package bridge

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"iter"
	"log/slog"

	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/pkg/id"
)

type Packet struct {
	Type   MessageType `json:"type"`
	Source string      `json:"source"`
	ID     string      `json:"id"`
	Index  int         `json:"index"`
	Data   string      `json:"data"`
	Final  bool        `json:"final"`
}

type MessageType int

const (
	MessageInit MessageType = iota
	MessagePing
	MessageNext
	MessageResponse
	MessageError
	MessageReboot
	MessageInitError
)

type Message struct {
	ID     string
	Type   MessageType
	Source string
	Body   io.Reader
}

type Writer struct {
	conn     *appsync.Connection
	message  MessageType
	source   string
	channel  string
	event    string
	buffer   []byte
	position int
	index    int
	id       string
}

type InitBody struct {
	FunctionID  string   `json:"functionID"`
	Environment []string `json:"environment"`
}

type PingBody struct {
}

type RebootBody struct {
}

func newWriter(conn *appsync.Connection, source string, channel string, message MessageType) *Writer {
	return &Writer{
		id:       id.Ascending(),
		conn:     conn,
		source:   source,
		message:  message,
		channel:  channel,
		buffer:   make([]byte, BUFFER_SIZE),
		position: 0,
		index:    0,
	}
}

func (w *Writer) SetID(id string) {
	w.id = id
}

const BUFFER_SIZE = 1024 * 128

func (w *Writer) Write(p []byte) (int, error) {
	total := 0

	for total < len(p) {
		space := cap(w.buffer) - w.position
		toWrite := min(space, len(p)-total)
		copy(w.buffer[w.position:], p[total:total+toWrite])
		w.position += toWrite
		total += toWrite
		if w.position == len(w.buffer) {
			if err := w.Flush(false); err != nil {
				return total, err
			}
		}
	}
	return total, nil
}

func (w *Writer) Flush(final bool) error {
	if !final && w.position == 0 {
		return nil
	}
	encoded := base64.StdEncoding.EncodeToString(w.buffer[:w.position])
	err := w.conn.Publish(context.Background(), w.channel, Packet{
		ID:     w.id,
		Index:  w.index,
		Type:   w.message,
		Source: w.source,
		Data:   encoded,
		Final:  final,
	})
	w.index++
	if err != nil {
		return err
	}
	w.buffer = make([]byte, BUFFER_SIZE)
	w.position = 0
	return nil
}

func (w *Writer) Close() error {
	return w.Flush(true)
}

type Client struct {
	as      *appsync.Connection
	prefix  string
	pending map[string]chan []byte
	out     chan Message
	source  string
}

func NewClient(ctx context.Context, as *appsync.Connection, source string, prefix string) *Client {
	slog.Info("subscribing to", "prefix", prefix+"/in")
	sub, _ := as.Subscribe(ctx, prefix+"/in")
	result := &Client{
		as:      as,
		source:  source,
		prefix:  prefix,
		pending: map[string]chan []byte{},
		out:     make(chan Message, 1000),
	}
	go func() {
		for packet := range sorted(ctx, sub) {
			pending, ok := result.pending[packet.ID]
			if !ok {
				pending = make(chan []byte, 100)
				result.pending[packet.ID] = pending
				result.out <- Message{
					Type:   packet.Type,
					ID:     packet.ID,
					Source: packet.Source,
					Body:   NewChannelReader(ctx, pending),
				}
			}
			bytes, err := base64.StdEncoding.DecodeString(packet.Data)
			if err != nil {
				continue
			}
			pending <- bytes
			if packet.Final {
				close(pending)
				delete(result.pending, packet.ID)
			}
		}
	}()

	return result
}

func (c *Client) Read() <-chan Message {
	return c.out
}

func (c *Client) NewWriter(message MessageType, destination string) *Writer {
	writer := newWriter(c.as, c.source, destination, message)
	return writer
}

type ChannelReader struct {
	ch     chan []byte
	buffer []byte
	err    error
	ctx    context.Context
}

func NewChannelReader(ctx context.Context, ch chan []byte) *ChannelReader {
	return &ChannelReader{
		ch:     ch,
		buffer: nil,
		err:    nil,
		ctx:    ctx,
	}
}

func (r *ChannelReader) Read(p []byte) (n int, err error) {
	if len(r.buffer) == 0 && r.err == nil {
		select {
		case chunk, ok := <-r.ch:
			if !ok {
				return 0, io.EOF
			}
			r.buffer = chunk
		case <-r.ctx.Done():
			return 0, io.EOF
		}
	}
	if len(r.buffer) > 0 {
		n = copy(p, r.buffer)
		r.buffer = r.buffer[n:]
		return n, nil
	}

	if r.err != nil {
		return 0, r.err
	}
	return 0, io.EOF
}

func sorted(ctx context.Context, sub appsync.SubscriptionChannel) iter.Seq[Packet] {
	return func(yield func(Packet) bool) {
		history := make(map[string]map[int]Packet)
		next := map[string]int{}
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-sub:
				var packet Packet
				json.Unmarshal([]byte(msg), &packet)
				slog.Info("got packet", "id", packet.ID, "type", packet.Type, "from", packet.Source)
				unprocessed, ok := history[packet.ID]
				if !ok {
					unprocessed = map[int]Packet{}
					history[packet.ID] = unprocessed
				}
				unprocessed[packet.Index] = packet
				for {
					index := next[packet.ID]
					envelope, ok := unprocessed[index]
					if !ok {
						break
					}
					delete(unprocessed, index)
					next[envelope.ID] = index + 1
					if !yield(envelope) {
						return
					}
					if envelope.Final {
						delete(history, envelope.ID)
					}
				}
			}

		}
	}
}
