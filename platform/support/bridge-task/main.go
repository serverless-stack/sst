package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/bridge"
	"github.com/sst/sst/v3/pkg/id"
)

var SST_APP = os.Getenv("SST_APP")
var SST_STAGE = os.Getenv("SST_STAGE")
var SST_TASK_ID = os.Getenv("SST_TASK_ID")
var SST_REGION = os.Getenv("SST_REGION")
var SST_APPSYNC_HTTP = os.Getenv("SST_APPSYNC_HTTP")
var SST_APPSYNC_REALTIME = os.Getenv("SST_APPSYNC_REALTIME")

var ENV_BLACKLIST = map[string]bool{}

func main() {
	if err := run(); err != nil {
		fmt.Println(err)
		os.Exit(1)
	}
}

func run() error {
	ctx, _ := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	workerID := id.Ascending()

	prefix := fmt.Sprintf("/sst/%s/%s", SST_APP, SST_STAGE)
	slog.Info("prefix", "value", prefix)
	config, err := config.LoadDefaultConfig(ctx, config.WithRegion(SST_REGION))
	if err != nil {
		return err
	}

	conn, err := appsync.Dial(ctx, config, SST_APPSYNC_HTTP, SST_APPSYNC_REALTIME)
	if err != nil {
		return err
	}
	client := bridge.NewClient(ctx, conn, workerID, prefix+"/"+workerID)

	init := bridge.TaskStartBody{
		TaskID:      SST_TASK_ID,
		Environment: []string{},
	}

	for _, e := range os.Environ() {
		key := strings.Split(e, "=")[0]
		if _, ok := ENV_BLACKLIST[key]; ok {
			continue
		}
		init.Environment = append(init.Environment, e)
	}
	creds, err := config.Credentials.Retrieve(ctx)
	if err != nil {
		return err
	}
	init.Environment = append(init.Environment, fmt.Sprintf("AWS_ACCESS_KEY_ID=%s", creds.AccessKeyID))
	init.Environment = append(init.Environment, fmt.Sprintf("AWS_SECRET_ACCESS_KEY=%s", creds.SecretAccessKey))
	init.Environment = append(init.Environment, fmt.Sprintf("AWS_SESSION_TOKEN=%s", creds.SessionToken))
	writer := client.NewWriter(bridge.MessageTaskStart, prefix+"/in")
	json.NewEncoder(writer).Encode(init)
	writer.Close()
	slog.Info("sent init")

	for {
		select {
		case <-ctx.Done():
			return nil
		case msg := <-client.Read():
			if msg.Source != "dev" {
				continue
			}
			switch msg.Type {
			case bridge.MessagePing:
				slog.Info("got ping")
				continue
			case bridge.MessageTaskComplete:
				slog.Info("task complete")
				return nil
			}
		case <-time.After(time.Second * 10):
			slog.Info("timeout")
			return nil
		}
	}

}
