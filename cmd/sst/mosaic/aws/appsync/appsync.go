package appsync

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/gorilla/websocket"
	"github.com/sst/ion/pkg/id"
)

type Connection struct {
	conn             *websocket.Conn
	cfg              aws.Config
	httpEndpoint     string
	realtimeEndpoint string
	subscriptions    map[string]SubscriptionChannel
	lock             sync.Mutex
}

type SubscriptionChannel = chan string

type SubscribeEvent struct {
	Type          string      `json:"type"`
	ID            string      `json:"id"`
	Channel       string      `json:"channel"`
	Authorization interface{} `json:"authorization"`
}

func Dial(
	ctx context.Context,
	cfg aws.Config,
	httpEndpoint string,
	realtimeEndpoint string,
) (*Connection, error) {
	result := &Connection{
		cfg:              cfg,
		httpEndpoint:     httpEndpoint,
		realtimeEndpoint: realtimeEndpoint,
		subscriptions:    map[string]SubscriptionChannel{},
	}
	auth, err := result.getAuth(ctx, map[string]interface{}{})
	if err != nil {
		return nil, err
	}
	authJson, err := json.Marshal(auth)
	if err != nil {
		return nil, err
	}
	auth64 := base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString(authJson)
	dialer := websocket.Dialer{
		Subprotocols: []string{"aws-appsync-event-ws", "header-" + auth64},
	}
	conn, _, err := dialer.DialContext(ctx, "wss://"+result.realtimeEndpoint+"/event/realtime", nil)
	if err != nil {
		return nil, err
	}
	result.conn = conn

	go func() {
		for {
			msg := map[string]interface{}{}
			err := conn.ReadJSON(&msg)
			if err != nil {
				return
			}

			if msg["type"] == "ka" {
			}

			if msg["type"] == "subscribe_success" {
				id := msg["id"].(string)
				if out, ok := result.subscriptions[id]; ok {
					out <- "ok"
				}
			}

			if t := msg["type"]; t == "data" {
				id := msg["id"].(string)
				if out, ok := result.subscriptions[id]; ok {
					out <- msg["event"].(string)
				}
			}
		}
	}()

	go func() {
		<-ctx.Done()
		conn.Close()
		for _, out := range result.subscriptions {
			close(out)
		}
	}()
	return result, nil
}

var ErrSubscriptionFailed = fmt.Errorf("subscription failed")

func (c *Connection) Subscribe(ctx context.Context, channel string) (SubscriptionChannel, error) {
	c.lock.Lock()
	defer c.lock.Unlock()
	auth, err := c.getAuth(ctx, map[string]interface{}{
		"channel": channel,
	})
	if err != nil {
		return nil, err
	}
	subscriptionID := id.Ascending()
	c.conn.WriteJSON(map[string]interface{}{
		"type":          "subscribe",
		"id":            subscriptionID,
		"channel":       channel,
		"authorization": auth,
	})
	out := make(SubscriptionChannel, 1000)
	c.subscriptions[subscriptionID] = out
	select {
	case <-out:
		return out, nil
	case <-time.After(time.Second * 3):
		return nil, ErrSubscriptionFailed
	}
}

func (c *Connection) getAuth(ctx context.Context, body interface{}) (interface{}, error) {
	credentials, err := c.cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, err
	}
	slog.Info("got auth", "body", credentials)
	bodyJson, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	bodyReader := bytes.NewReader(bodyJson)
	req, err := http.NewRequest("POST",
		"https://"+c.httpEndpoint+"/event",
		bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("accept", "application/json, text/javascript")
	req.Header.Set("content-encoding", "amz-1.0")
	req.Header.Set("content-type", "application/json; charset=UTF-8")

	// Compute SHA256 hash of the payload
	h := sha256.New()
	h.Write(bodyJson)
	payloadHash := hex.EncodeToString(h.Sum(nil))

	signer := v4.NewSigner()
	err = signer.SignHTTP(ctx,
		credentials,
		req,
		payloadHash,
		"appsync",
		c.cfg.Region,
		time.Now(),
	)
	auth := map[string]string{
		"accept":           req.Header.Get("accept"),
		"content-encoding": req.Header.Get("content-encoding"),
		"content-type":     req.Header.Get("content-type"),
		"host":             req.Host,
		"x-amz-date":       req.Header.Get("x-amz-date"),
		"Authorization":    req.Header.Get("Authorization"),
	}
	if req.Header.Get("X-Amz-Security-Token") != "" {
		auth["X-Amz-Security-Token"] = req.Header.Get("X-Amz-Security-Token")
	}
	return auth, nil
}

func (c *Connection) Publish(ctx context.Context, channel string, event interface{}) error {
	credentials, err := c.cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return err
	}
	eventJson, err := json.Marshal(event)
	body, err := json.Marshal(map[string]interface{}{
		"channel": channel,
		"events":  []string{string(eventJson)},
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequest("POST", "https://"+c.httpEndpoint+"/event", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	signer := v4.NewSigner()
	h := sha256.New()
	h.Write(body)
	payloadHash := hex.EncodeToString(h.Sum(nil))
	err = signer.SignHTTP(ctx, credentials, req, payloadHash, "appsync", c.cfg.Region, time.Now())
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}
