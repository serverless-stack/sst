package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/cmd/sst/mosaic/aws/bridge"
)

var httpEndpoint = "n4htb7uc7nblji2hrximdbpwky.appsync-api.us-east-1.amazonaws.com"
var realtimeEndpoint = "n4htb7uc7nblji2hrximdbpwky.appsync-realtime-api.us-east-1.amazonaws.com"

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-c
		cancel()
	}()
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}
	conn, err := appsync.Dial(ctx, cfg, httpEndpoint, realtimeEndpoint)
	if err != nil {
		panic(err)
	}
	prefix := fmt.Sprintf("/sst/%s/%s", "aws-hono", "thdxr")
	if os.Getenv("SERVER") == "" {
		ping, err := conn.Subscribe(ctx, prefix+"/ping")
		if err != nil {
			panic(err)
		}
		client := bridge.NewClient(ctx, conn, prefix)
		workers := map[string]bool{}
		for msg := range ping {
			var ping bridge.PingEvent
			json.Unmarshal([]byte(msg), &ping)
			conn.Publish(ctx, prefix+"/"+ping.WorkerID+"/ping", "ok")
			if _, ok := workers[ping.WorkerID]; !ok {
				fmt.Println("ping for new worker", ping)
				workers[ping.WorkerID] = true
				go func(workerID string) {
					req, err := http.NewRequest("GET", "http://lambda/init", nil)
					if err != nil {
						panic(err)
					}
					fmt.Println("-->", req.URL.Path)
					resp, err := client.Do(ctx, workerID, req)
					if err != nil {
						panic(err)
					}
					fmt.Println("<--", resp.Status)
					init := bridge.InitEvent{}
					json.NewDecoder(resp.Body).Decode(&init)
					for {
						req, err := http.NewRequest("GET", "http://lambda/2018-06-01/runtime/invocation/next", nil)
						fmt.Println("-->", req.URL.Path)
						if err != nil {
							panic(err)
						}
						resp, err := client.Do(ctx, init.WorkerID, req)
						if err != nil {
							panic(err)
						}
						fmt.Println("<--", resp.Status)
						requestID := resp.Header.Get("lambda-runtime-aws-request-id")
						bigString := strings.Repeat("a", 1024)
						req, err = http.NewRequest("POST", "http://lambda/2018-06-01/runtime/invocation/"+requestID+"/response", strings.NewReader(bigString))
						fmt.Println("-->", req.URL.Path)
						if err != nil {
							panic(err)
						}
						resp, err = client.Do(ctx, init.WorkerID, req)
						fmt.Println("<--", resp.Status)
					}
				}(ping.WorkerID)
			}
		}
	} else {
		fmt.Println("listening")
		bridge.Listen(ctx, conn, prefix, "worker", func(f func(*http.Response), req *http.Request) {
			req.URL.Host = req.Host
			req.URL.Scheme = "https"
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				fmt.Println(err)
				return
			}
			f(resp)
		})
	}
}
