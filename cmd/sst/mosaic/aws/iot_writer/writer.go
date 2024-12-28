package iot_writer

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go/aws"
	MQTT "github.com/eclipse/paho.mqtt.golang"
	"github.com/sst/sst/v3/internal/util"
)

const BUFFER_SIZE = 1024 * 120
const MAX_COUNT = 3

type IoTWriter struct {
	topic  string
	count  int
	s3     *s3.Client
	bucket string
	client MQTT.Client
	buffer []byte // buffer to accumulate data
	last   time.Time
}

func New(client MQTT.Client, s3 *s3.Client, bucket string, topic string) *IoTWriter {
	return &IoTWriter{
		client: client,
		buffer: make([]byte, 0, BUFFER_SIZE),
		topic:  topic,
		last:   time.Now(),
		s3:     s3,
		bucket: bucket,
	}
}

func (iw *IoTWriter) Write(p []byte) (int, error) {
	totalWritten := 0

	for len(p) > 0 {
		if iw.count == MAX_COUNT {
			iw.buffer = append(iw.buffer, p...)
			break
		}
		// Calculate the space left in the buffer
		spaceLeft := BUFFER_SIZE - len(iw.buffer)

		// Determine how much data to copy to the buffer
		toCopy := min(spaceLeft, len(p))

		// Append data to the buffer
		iw.buffer = append(iw.buffer, p[:toCopy]...)

		// Update the slice p and totalWritten
		p = p[toCopy:]
		totalWritten += toCopy

		// If the buffer is full, write the chunk
		if len(iw.buffer) == BUFFER_SIZE {
			iw.flush()
		}
	}

	return totalWritten, nil
}

func (iw *IoTWriter) flush() error {
	if len(iw.buffer) > 0 {
		slog.Info("writing to topic", "topic", iw.topic, "data", len(iw.buffer))
		// encode int to 4 bytes at the beginning of the buffer
		var buf [4]byte
		binary.BigEndian.PutUint32(buf[:], uint32(iw.count))
		iw.buffer = append(buf[:], iw.buffer...)
		iw.count++
		token := iw.client.Publish(iw.topic, 1, false, iw.buffer)
		if token.Wait() && token.Error() != nil {
			return token.Error()
		}
		iw.last = time.Now()
		iw.buffer = iw.buffer[:0]
	}
	return nil
}

func (iw *IoTWriter) Close() error {
	if len(iw.buffer) <= BUFFER_SIZE {
		iw.flush()
	} else {
		slog.Info("flushing to s3")
		key := "temporary/" + util.RandomString(8)
		iw.s3.PutObject(context.TODO(), &s3.PutObjectInput{
			Bucket: aws.String(iw.bucket),
			Key:    aws.String(key),
			Body:   bytes.NewReader(iw.buffer),
		})
		bytes := make([]byte, 4)
		binary.BigEndian.PutUint32(bytes, uint32(iw.count))
		iw.count++
		bytes = append(bytes, []byte("blk"+iw.bucket+"|"+key)...)
		token := iw.client.Publish(iw.topic, 1, false, bytes)
		if token.Wait() && token.Error() != nil {
			return token.Error()
		}
	}
	bytes := make([]byte, 4)
	binary.BigEndian.PutUint32(bytes, uint32(iw.count))
	token := iw.client.Publish(iw.topic, 1, false, bytes)
	if token.Wait() && token.Error() != nil {
		return token.Error()
	}
	slog.Info("closed iot writer", "topic", iw.topic, "count", iw.count)
	return nil
}

type Reader struct {
	buffer map[string]map[int]ReadMsg
	next   map[string]int
	s3     *s3.Client
}

type ReadMsg struct {
	ID   string
	Data []byte
}

func NewReader(s3 *s3.Client) *Reader {
	return &Reader{
		buffer: map[string]map[int]ReadMsg{},
		next:   map[string]int{},
		s3:     s3,
	}
}

func (r *Reader) Read(m MQTT.Message) []ReadMsg {
	payload := m.Payload()
	topic := m.Topic()
	requestID := strings.Split(topic, "/")[5]
	requestBuffer, ok := r.buffer[requestID]
	if !ok {
		requestBuffer = map[int]ReadMsg{}
		r.buffer[requestID] = requestBuffer
	}
	id := int(binary.BigEndian.Uint32(payload[:4]))
	payload = payload[4:]
	if bytes.HasPrefix(payload, []byte("blk")) {
		data := string(payload)
		bucket, key, _ := strings.Cut(data[3:], "|")
		slog.Info("fetching from s3", "bucket", bucket, "key", key)
		resp, _ := r.s3.GetObject(context.TODO(), &s3.GetObjectInput{
			Bucket: aws.String(bucket),
			Key:    aws.String(key),
		})
		payload, _ = io.ReadAll(resp.Body)
	}
	requestBuffer[id] = ReadMsg{
		Data: payload,
		ID:   requestID,
	}
	result := []ReadMsg{}
	for {
		next := r.next[requestID]
		match, ok := requestBuffer[next]
		if !ok {
			break
		}
		delete(requestBuffer, next)
		r.next[requestID]++
		result = append(result, match)
	}
	return result
}

// min returns the smaller of x or y.
func min(x, y int) int {
	if x < y {
		return x
	}
	return y
}
