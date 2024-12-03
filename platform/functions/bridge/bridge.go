package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/cmd/sst/mosaic/aws/bridge"
)

var version = "0.0.1"
var LAMBDA_RUNTIME_API = os.Getenv("AWS_LAMBDA_RUNTIME_API")
var SST_APP = os.Getenv("SST_APP")
var SST_STAGE = os.Getenv("SST_STAGE")
var SST_FUNCTION_ID = os.Getenv("SST_FUNCTION_ID")
var SST_FUNCTION_TIMEOUT = os.Getenv("SST_FUNCTION_TIMEOUT")
var SST_REGION = os.Getenv("SST_REGION")
var SST_ASSET_BUCKET = os.Getenv("SST_ASSET_BUCKET")
var SST_APPSYNC_HTTP = os.Getenv("SST_APPSYNC_HTTP")
var SST_APPSYNC_REALTIME = os.Getenv("SST_APPSYNC_REALTIME")

var ENV_BLACKLIST = map[string]bool{
	"SST_DEBUG_ENDPOINT":              true,
	"SST_DEBUG_SRC_HANDLER":           true,
	"SST_DEBUG_SRC_PATH":              true,
	"AWS_LAMBDA_FUNCTION_MEMORY_SIZE": true,
	"AWS_LAMBDA_LOG_GROUP_NAME":       true,
	"AWS_LAMBDA_LOG_STREAM_NAME":      true,
	"LD_LIBRARY_PATH":                 true,
	"LAMBDA_TASK_ROOT":                true,
	"AWS_LAMBDA_RUNTIME_API":          true,
	"AWS_EXECUTION_ENV":               true,
	"AWS_XRAY_DAEMON_ADDRESS":         true,
	"AWS_LAMBDA_INITIALIZATION_TYPE":  true,
	"PATH":                            true,
	"PWD":                             true,
	"LAMBDA_RUNTIME_DIR":              true,
	"LANG":                            true,
	"NODE_PATH":                       true,
	"SHLVL":                           true,
	"AWS_XRAY_DAEMON_PORT":            true,
	"AWS_XRAY_CONTEXT_MISSING":        true,
	"_HANDLER":                        true,
	"_LAMBDA_CONSOLE_SOCKET":          true,
	"_LAMBDA_CONTROL_SOCKET":          true,
	"_LAMBDA_LOG_FD":                  true,
	"_LAMBDA_RUNTIME_LOAD_TIME":       true,
	"_LAMBDA_SB_ID":                   true,
	"_LAMBDA_SERVER_PORT":             true,
	"_LAMBDA_SHARED_MEM_FD":           true,
}

func main() {
	err := run()
	if err != nil {
		slog.Error("run failed", "err", err)
	}
}

func run() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT, syscall.SIGHUP)

	go func() {
		slog.Info("waiting for interrupt signal")
		<-sigs
		slog.Info("got interrupt signal")
		cancel()
	}()
	defer cancel()

	logStreamName := os.Getenv("AWS_LAMBDA_LOG_STREAM_NAME")
	workerID := logStreamName[len(logStreamName)-32:]
	prefix := fmt.Sprintf("/sst/%s/%s", SST_APP, SST_STAGE)
	config, err := config.LoadDefaultConfig(ctx, config.WithRegion(SST_REGION))
	if err != nil {
		return err
	}

	conn, err := appsync.Dial(ctx, config, SST_APPSYNC_HTTP, SST_APPSYNC_REALTIME)
	if err != nil {
		return err
	}
	defer conn.Publish(ctx, prefix+"/exit", bridge.ExitEvent{
		WorkerID:   workerID,
		FunctionID: SST_FUNCTION_ID,
	})
	defer slog.Info("exiting")

	init := bridge.InitEvent{
		FunctionID:  SST_FUNCTION_ID,
		WorkerID:    workerID,
		Environment: []string{},
	}
	for _, e := range os.Environ() {
		key := strings.Split(e, "=")[0]
		if _, ok := ENV_BLACKLIST[key]; ok {
			continue
		}
		init.Environment = append(init.Environment, e)
	}
	ping, _ := conn.Subscribe(ctx, prefix+"/"+workerID+"/ping")
	next := make(chan *http.Response)
	step := make(chan string, 1)
	go func() {
		client := &http.Client{
			Transport: &http.Transport{
				DisableKeepAlives: false,
			},
			Timeout: 0,
		}
		for {
			resp, err := client.Get("http://" + LAMBDA_RUNTIME_API + "/2018-06-01/runtime/invocation/next")
			fmt.Println("status", resp.Status)
			if err != nil {
				cancel()
				return
			}
			requestID := resp.Header.Get("lambda-runtime-aws-request-id")
			conn.Publish(ctx, prefix+"/ping", bridge.PingEvent{WorkerID: workerID})

			go func() {
				select {
				case <-ping:
					return
				case <-time.After(time.Second * 3):
					fmt.Println("timeout", requestID)
					client.Post("http://"+LAMBDA_RUNTIME_API+"/2018-06-01/runtime/invocation/"+requestID+"/response", "application/json", strings.NewReader(`{"body":"sst dev is not running"}`))
					step <- "done"
					return
				}
			}()

			body, _ := io.ReadAll(resp.Body)
		loop:
			for {
				select {
				case val := <-step:
					switch val {
					case "next":
						clonedResp := *resp
						clonedResp.Body = io.NopCloser(bytes.NewReader(body))
						next <- &clonedResp
					case "done":
						break loop
					}
				}
			}
		}
	}()

	return bridge.Listen(ctx, conn, prefix, workerID, func(f func(*http.Response), req *http.Request) {
		if req.URL.Path == "/init" {
			encoded, _ := json.Marshal(init)
			f(&http.Response{
				StatusCode: 200,
				Body:       io.NopCloser(bytes.NewReader(encoded)),
				Header: http.Header{
					"Content-Type": []string{"application/json"},
				},
			})
			return
		}
		if strings.HasSuffix(req.URL.Path, "/next") {
			step <- "next"
			f(<-next)
			return
		}
		req.URL.Host = LAMBDA_RUNTIME_API
		req.URL.Scheme = "http"
		fmt.Println("proxying", req.URL.Path)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Println(err)
			return
		}
		fmt.Println("sent response", req.URL.Path, resp.StatusCode)
		f(resp)
		if strings.HasSuffix(req.URL.Path, "/response") || strings.HasSuffix(req.URL.Path, "/error") {
			fmt.Println("marking done")
			step <- "done"
		}
	})
}
