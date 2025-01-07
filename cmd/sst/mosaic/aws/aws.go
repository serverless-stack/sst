package aws

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/bridge"
	"github.com/sst/sst/v3/pkg/project"
	"github.com/sst/sst/v3/pkg/project/provider"
	"github.com/sst/sst/v3/pkg/server"
)

var ErrIoTDelay = fmt.Errorf("iot not available")
var ErrAppsyncNotReady = fmt.Errorf("appsync not ready")

func Start(
	ctx context.Context,
	p *project.Project,
	s *server.Server,
	args map[string]interface{},
) error {
	uncasted, _ := p.Provider("aws")
	prov := uncasted.(*provider.AwsProvider)
	config := prov.Config()
	slog.Info("getting endpoint")
	prefix := fmt.Sprintf("/sst/%s/%s", p.App().Name, p.App().Stage)

	rest, realtime, err := prov.ResolveAppSync(ctx)
	if err != nil {
		return err
	}
	slog.Info("found appsync", "rest", rest, "realtime", realtime)

	now := time.Now()
	for {
		slog.Info("checking if appsync is ready")
		_, err := http.Get("https://" + rest)
		if err != nil {
			slog.Error("appsync not ready", "err", err)
			if time.Since(now) > time.Second*10 {
				return ErrAppsyncNotReady
			}
			time.Sleep(time.Second)
			continue
		}
		break
	}
	conn, err := appsync.Dial(ctx, config, rest, realtime)
	if err != nil {
		return err
	}
	client := bridge.NewClient(ctx, conn, "dev", prefix)

	functionsChan := make(chan bridge.Message, 1000)
	tasksChan := make(chan bridge.Message, 1000)

	in := input{
		config:  config,
		server:  s,
		client:  client,
		project: p,
		prefix:  prefix,
	}

	in.msg = functionsChan
	go function(ctx, in)

	in.msg = tasksChan
	go task(ctx, in)

	for {
		select {
		case <-ctx.Done():
			return nil
		case msg := <-client.Read():
			if msg.Source == "dev" {
				continue
			}
			functionsChan <- msg
			tasksChan <- msg
		}
	}
}
