package bridge

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"iter"
	"net/http"
	"sync"

	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/pkg/id"
)

type Envelope struct {
	ID    string `json:"id"`
	Index int    `json:"index"`
	Data  string `json:"data"`
	Final bool   `json:"final"`
}

type Writer struct {
	conn     *appsync.Connection
	channel  string
	event    string
	buffer   []byte
	position int
	index    int
	id       string
}

type InitEvent struct {
	WorkerID    string   `json:"workerID"`
	FunctionID  string   `json:"functionID"`
	Environment []string `json:"environment"`
}

type PingEvent struct {
	WorkerID string `json:"workerID"`
}

type ExitEvent struct {
	WorkerID   string `json:"workerID"`
	FunctionID string `json:"functionID"`
}

func NewWriter(conn *appsync.Connection, channel string, requestID string) *Writer {
	return &Writer{
		id:       requestID,
		conn:     conn,
		channel:  channel,
		buffer:   make([]byte, BUFFER_SIZE),
		position: 0,
		index:    0,
	}
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
	err := w.conn.Publish(context.Background(), w.channel, Envelope{
		ID:    w.id,
		Index: w.index,
		Data:  encoded,
		Final: final,
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
	as        *appsync.Connection
	prefix    string
	responses map[string]chan []byte
	lock      sync.RWMutex
}

func NewClient(ctx context.Context, as *appsync.Connection, prefix string) *Client {
	sub, _ := as.Subscribe(ctx, prefix+"/response")
	result := &Client{
		as:        as,
		prefix:    prefix,
		responses: map[string]chan []byte{},
	}
	go func() {
		for msg := range sorted(ctx, sub) {
			result.lock.RLock()
			responseChannel, ok := result.responses[msg.ID]
			result.lock.RUnlock()
			if !ok {
				continue
			}
			bytes, err := base64.StdEncoding.DecodeString(msg.Data)
			if err != nil {
				continue
			}
			responseChannel <- bytes
			if msg.Final {
				close(responseChannel)
				result.lock.Lock()
				delete(result.responses, msg.ID)
				result.lock.Unlock()
			}
		}
	}()

	return result
}

func (c *Client) Do(ctx context.Context, workerID string, req *http.Request) (*http.Response, error) {
	channel := c.prefix + "/" + workerID
	requestID := id.Ascending()
	c.lock.Lock()
	c.responses[requestID] = make(chan []byte, 100)
	c.lock.Unlock()
	writer := NewWriter(c.as, channel, requestID)
	req.Write(writer)
	writer.Close()
	reader := NewChannelReader(ctx, c.responses[writer.id])
	resp, err := http.ReadResponse(bufio.NewReader(reader), req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

type ChannelReader struct {
	ch     <-chan []byte
	buffer []byte
	err    error
	ctx    context.Context
}

func NewChannelReader(ctx context.Context, ch <-chan []byte) *ChannelReader {
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

func Listen(
	ctx context.Context,
	as *appsync.Connection,
	prefix string,
	workerID string,
	handler func(func(*http.Response), *http.Request),
) error {
	requests := map[string]chan []byte{}
	sub, _ := as.Subscribe(ctx, prefix+"/"+workerID)
	for msg := range sorted(ctx, sub) {
		decoded, _ := base64.StdEncoding.DecodeString(msg.Data)
		reqChan, ok := requests[msg.ID]
		if !ok {
			reqChan = make(chan []byte)
			requests[msg.ID] = reqChan
			go func(id string) {
				reader := NewChannelReader(ctx, reqChan)
				req, _ := http.ReadRequest(bufio.NewReader(reader))
				cloned := req.Clone(ctx)
				cloned.RequestURI = ""
				cb := func(resp *http.Response) {
					writer := NewWriter(as, prefix+"/response", id)
					resp.Write(writer)
					writer.Close()
				}
				handler(cb, cloned)
			}(msg.ID)
		}
		reqChan <- decoded
		if msg.Final {
			close(reqChan)
			delete(requests, msg.ID)
		}
	}
	return nil
}

func sorted(ctx context.Context, sub appsync.SubscriptionChannel) iter.Seq[Envelope] {
	return func(yield func(Envelope) bool) {
		history := make(map[string]map[int]Envelope)
		next := map[string]int{}
		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-sub:
				var envelope Envelope
				json.Unmarshal([]byte(msg), &envelope)
				unprocessed, ok := history[envelope.ID]
				if !ok {
					unprocessed = map[int]Envelope{}
					history[envelope.ID] = unprocessed
				}
				unprocessed[envelope.Index] = envelope
				for {
					index := next[envelope.ID]
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
