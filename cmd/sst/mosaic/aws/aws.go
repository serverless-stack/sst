package aws

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	appsyncSdk "github.com/aws/aws-sdk-go-v2/service/appsync"
	appsyncTypes "github.com/aws/aws-sdk-go-v2/service/appsync/types"
	MQTT "github.com/eclipse/paho.mqtt.golang"
	"github.com/sst/ion/cmd/sst/mosaic/aws/appsync"
	"github.com/sst/ion/cmd/sst/mosaic/aws/bridge"
	"github.com/sst/ion/cmd/sst/mosaic/watcher"
	"github.com/sst/ion/pkg/bus"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
	"github.com/sst/ion/pkg/runtime"
	"github.com/sst/ion/pkg/server"
)

type fragment struct {
	ID    string `json:"id"`
	Index int    `json:"index"`
	Count int    `json:"count"`
	Data  string `json:"data"`
}

type FunctionInvokedEvent struct {
	FunctionID string
	WorkerID   string
	RequestID  string
	Input      []byte
}

type FunctionResponseEvent struct {
	FunctionID string
	WorkerID   string
	RequestID  string
	Output     []byte
}

type FunctionErrorEvent struct {
	FunctionID   string
	WorkerID     string
	RequestID    string
	ErrorType    string   `json:"errorType"`
	ErrorMessage string   `json:"errorMessage"`
	Trace        []string `json:"trace"`
}

type FunctionBuildEvent struct {
	FunctionID string
	Errors     []string
}

type FunctionLogEvent struct {
	FunctionID string
	WorkerID   string
	RequestID  string
	Line       string
}

var ErrIoTDelay = fmt.Errorf("iot not available")

func Start(
	ctx context.Context,
	p *project.Project,
	s *server.Server,
	args map[string]interface{},
) error {
	server := fmt.Sprintf("localhost:%d/lambda/", s.Port)
	uncasted, _ := p.Provider("aws")
	prov := uncasted.(*provider.AwsProvider)
	config := prov.Config()
	slog.Info("getting endpoint")
	shutdownChan := make(chan MQTT.Message, 1000)
	prefix := fmt.Sprintf("/sst/%s/%s", p.App().Name, p.App().Stage)

	type WorkerInfo struct {
		FunctionID       string
		WorkerID         string
		Worker           runtime.Worker
		CurrentRequestID string
		Env              []string
	}

	workerShutdownChan := make(chan *WorkerInfo, 1000)
	nextChan := map[string]chan io.Reader{}
	workers := map[string]*WorkerInfo{}
	evts := bus.Subscribe(&watcher.FileChangedEvent{}, &project.CompleteEvent{}, &runtime.BuildInput{}, &FunctionInvokedEvent{})
	rest, realtime, err := resolveAppSync(ctx, config)
	if err != nil {
		return err
	}
	slog.Info("found appsync", "rest", rest, "realtime", realtime)
	conn, err := appsync.Dial(ctx, config, rest, realtime)
	if err != nil {
		return err
	}
	client := bridge.NewClient(ctx, conn, "dev", prefix)

	go fileLogger(p)
	go func() {
		workerEnv := map[string][]string{}
		builds := map[string]*runtime.BuildOutput{}
		targets := map[string]*runtime.BuildInput{}

		getBuildOutput := func(functionID string) *runtime.BuildOutput {
			build := builds[functionID]
			if build != nil {
				return build
			}
			target, _ := targets[functionID]
			build, err = p.Runtime.Build(ctx, target)
			if err == nil {
				bus.Publish(&FunctionBuildEvent{
					FunctionID: functionID,
					Errors:     build.Errors,
				})
			} else {
				bus.Publish(&FunctionBuildEvent{
					FunctionID: functionID,
					Errors:     []string{err.Error()},
				})
			}
			if err != nil || len(build.Errors) > 0 {
				delete(builds, functionID)
				return nil
			}
			builds[functionID] = build
			return build
		}

		run := func(functionID string, workerID string) bool {
			build := getBuildOutput(functionID)
			if build == nil {
				return false
			}
			target, ok := targets[functionID]
			if !ok {
				return false
			}
			worker, err := p.Runtime.Run(ctx, &runtime.RunInput{
				CfgPath:    p.PathConfig(),
				Runtime:    target.Runtime,
				Server:     server + workerID,
				WorkerID:   workerID,
				FunctionID: functionID,
				Build:      build,
				Env:        workerEnv[workerID],
			})
			if err != nil {
				slog.Error("failed to run worker", "error", err)
				return false
			}
			info := &WorkerInfo{
				FunctionID: functionID,
				Worker:     worker,
				WorkerID:   workerID,
			}
			go func() {
				logs := worker.Logs()
				scanner := bufio.NewScanner(logs)
				for scanner.Scan() {
					line := scanner.Text()
					bus.Publish(&FunctionLogEvent{
						FunctionID: functionID,
						WorkerID:   workerID,
						RequestID:  info.CurrentRequestID,
						Line:       line,
					})
				}
				workerShutdownChan <- info
			}()
			workers[workerID] = info

			return true
		}

		for {
			select {
			case <-ctx.Done():
				return
			case msg := <-client.Read():
				if msg.Source == "dev" {
					continue
				}
				slog.Info("got bridge message", "type", msg.Type, "from", msg.Source)
				switch msg.Type {
				case bridge.MessageInit:
					init := bridge.InitBody{}
					json.NewDecoder(msg.Body).Decode(&init)
					slog.Info("worker init", "workerID", msg.Source, "functionID", init.FunctionID)
					if _, ok := targets[init.FunctionID]; !ok {
						continue
					}
					workerID := msg.Source
					if _, ok := workers[workerID]; ok {
						continue
					}
					workerEnv[workerID] = init.Environment
					if ok := run(init.FunctionID, workerID); !ok {
						result, err := http.Post("http://"+server+workerID+"/runtime/init/error", "application/json", strings.NewReader(`{"errorMessage":"Function failed to build"}`))
						if err != nil {
							continue
						}
						defer result.Body.Close()
						body, err := io.ReadAll(result.Body)
						if err != nil {
							continue
						}
						slog.Info("error", "body", string(body), "status", result.StatusCode)

						if result.StatusCode != 202 {
							result, err := http.Get("http://" + server + workerID + "/runtime/invocation/next")
							if err != nil {
								continue
							}
							requestID := result.Header.Get("lambda-runtime-aws-request-id")
							result, err = http.Post("http://"+server+workerID+"/runtime/invocation/"+requestID+"/error", "application/json", strings.NewReader(`{"errorMessage":"Function failed to build"}`))
							if err != nil {
								continue
							}
							defer result.Body.Close()
							body, err := io.ReadAll(result.Body)
							if err != nil {
								continue
							}
							slog.Info("error", "body", string(body), "status", result.StatusCode)
						}
					}
				case bridge.MessageNext:
					ch, ok := nextChan[msg.Source]
					if !ok {
						ch = make(chan io.Reader, 100)
						nextChan[msg.Source] = ch
					}
					_, ok = workers[msg.Source]
					if !ok {
						slog.Info("asking for reboot", "workerID", msg.Source)
						writer := client.NewWriter(bridge.MessageReboot, prefix+"/"+msg.Source+"/in")
						json.NewEncoder(writer).Encode(bridge.RebootBody{})
						writer.Close()
					}
					ch <- msg.Body
					continue
				default:
					io.ReadAll(msg.Body)
				}

			case info := <-workerShutdownChan:
				slog.Info("worker died", "workerID", info.WorkerID)
				existing, ok := workers[info.WorkerID]
				if !ok {
					continue
				}
				// only delete if a new worker hasn't already been started
				if existing == info {
					slog.Info("deleting worker", "workerID", info.WorkerID)
					delete(workers, info.WorkerID)
				}
				break
			case unknown := <-evts:
				switch evt := unknown.(type) {
				case *FunctionInvokedEvent:
					info, ok := workers[evt.WorkerID]
					if !ok {
						continue
					}
					info.CurrentRequestID = evt.RequestID
				case *project.CompleteEvent:
					for _, info := range workers {
						info.Worker.Stop()
					}
					builds = map[string]*runtime.BuildOutput{}
				case *runtime.BuildInput:
					targets[evt.FunctionID] = evt
				case *watcher.FileChangedEvent:
					slog.Info("checking if code needs to be rebuilt", "file", evt.Path)
					toBuild := map[string]bool{}

					for functionID := range builds {
						target, ok := targets[functionID]
						if !ok {
							continue
						}
						if p.Runtime.ShouldRebuild(target.Runtime, target.FunctionID, evt.Path) {
							for _, worker := range workers {
								if worker.FunctionID == functionID {
									slog.Info("stopping", "workerID", worker.WorkerID, "functionID", worker.FunctionID)
									worker.Worker.Stop()
								}
							}
							delete(builds, functionID)
							toBuild[functionID] = true
						}
					}

					for functionID := range toBuild {
						output := getBuildOutput(functionID)
						if output == nil {
							delete(toBuild, functionID)
						}
					}

					for workerID, info := range workers {
						if toBuild[info.FunctionID] {
							run(info.FunctionID, workerID)
						}
					}
					break
				}
			case m := <-shutdownChan:
				workerID := strings.Split(m.Topic(), "/")[3]
				info, ok := workers[workerID]
				if !ok {
					continue
				}
				info.Worker.Stop()
				delete(workers, workerID)
				delete(workerEnv, workerID)
			}
		}
	}()

	s.Mux.HandleFunc(`/lambda/{workerID}/runtime/invocation/next`, func(w http.ResponseWriter, r *http.Request) {
		slog.Info("got next request", "workerID", r.PathValue("workerID"))
		workerID := r.PathValue("workerID")
		ch := nextChan[workerID]
		select {
		case <-r.Context().Done():
			return
		case reader := <-ch:
			writer := client.NewWriter(bridge.MessageNext, prefix+"/"+r.PathValue("workerID")+"/in")
			json.NewEncoder(writer).Encode(bridge.PingBody{})
			writer.Close()
			resp, _ := http.ReadResponse(bufio.NewReader(reader), r)
			requestID := resp.Header.Get("lambda-runtime-aws-request-id")
			for key, values := range resp.Header {
				for _, value := range values {
					w.Header().Add(key, value)
				}
			}
			w.WriteHeader(resp.StatusCode)

			var buf bytes.Buffer
			tee := io.TeeReader(resp.Body, &buf)
			io.Copy(w, tee)
			workerInfo, ok := workers[workerID]
			if ok {
				bus.Publish(&FunctionInvokedEvent{
					FunctionID: workerInfo.FunctionID,
					WorkerID:   workerID,
					RequestID:  requestID,
					Input:      buf.Bytes(),
				})
			}
		}
	})

	s.Mux.HandleFunc(`/lambda/{workerID}/runtime/init/error`, func(w http.ResponseWriter, r *http.Request) {
		workerID := r.PathValue("workerID")
		slog.Info("got init error", "workerID", workerID, "requestID", r.PathValue("requestID"))
		writer := client.NewWriter(bridge.MessageInitError, prefix+"/"+workerID+"/in")
		var buf bytes.Buffer
		tee := io.TeeReader(r.Body, &buf)
		io.Copy(writer, tee)
		writer.Close()
		w.WriteHeader(200)
		info, ok := workers[workerID]
		if ok {
			fee := &FunctionErrorEvent{
				FunctionID: info.FunctionID,
				WorkerID:   info.WorkerID,
			}
			json.Unmarshal(buf.Bytes(), &fee)
			bus.Publish(fee)
		}
	})

	s.Mux.HandleFunc(`/lambda/{workerID}/runtime/invocation/{requestID}/response`, func(w http.ResponseWriter, r *http.Request) {
		workerID := r.PathValue("workerID")
		requestID := r.PathValue("requestID")
		slog.Info("got response", "workerID", workerID, "requestID", r.PathValue("requestID"))
		writer := client.NewWriter(bridge.MessageResponse, prefix+"/"+workerID+"/in")
		writer.SetID(requestID)
		var buf bytes.Buffer
		tee := io.TeeReader(r.Body, &buf)
		io.Copy(writer, tee)
		writer.Close()
		w.WriteHeader(200)
		info, ok := workers[workerID]
		if ok {
			bus.Publish(&FunctionResponseEvent{
				FunctionID: info.FunctionID,
				WorkerID:   workerID,
				RequestID:  requestID,
				Output:     buf.Bytes(),
			})
		}
	})

	s.Mux.HandleFunc(`/lambda/{workerID}/runtime/invocation/{requestID}/error`, func(w http.ResponseWriter, r *http.Request) {
		workerID := r.PathValue("workerID")
		requestID := r.PathValue("requestID")
		slog.Info("got error", "workerID", workerID, "requestID", r.PathValue("requestID"))
		writer := client.NewWriter(bridge.MessageError, prefix+"/"+workerID+"/in")
		writer.SetID(requestID)
		var buf bytes.Buffer
		tee := io.TeeReader(r.Body, &buf)
		io.Copy(writer, tee)
		writer.Close()
		w.WriteHeader(200)
		info, ok := workers[workerID]
		if ok {
			fee := &FunctionErrorEvent{
				FunctionID: info.FunctionID,
				WorkerID:   info.WorkerID,
				RequestID:  requestID,
			}
			json.Unmarshal(buf.Bytes(), &fee)
			bus.Publish(fee)
		}
	})

	<-ctx.Done()
	return nil
}

func fileLogger(p *project.Project) {
	evts := bus.Subscribe(&FunctionLogEvent{}, &FunctionInvokedEvent{}, &FunctionResponseEvent{}, &FunctionErrorEvent{}, &FunctionBuildEvent{})
	logs := map[string]*os.File{}

	getLog := func(functionID string, requestID string) *os.File {
		log, ok := logs[requestID]
		if !ok {
			path := p.PathLog(fmt.Sprintf("lambda/%s/%d-%s", functionID, time.Now().Unix(), requestID))
			os.MkdirAll(filepath.Dir(path), 0755)
			log, _ = os.Create(path)
			logs[requestID] = log
		}
		return log
	}

	for range evts {
		for evt := range evts {
			switch evt := evt.(type) {
			case *FunctionInvokedEvent:
				log := getLog(evt.FunctionID, evt.RequestID)
				log.WriteString("invocation " + evt.RequestID + "\n")
				log.WriteString(string(evt.Input))
				log.WriteString("\n")
			case *FunctionLogEvent:
				getLog(evt.FunctionID, evt.RequestID).WriteString(evt.Line + "\n")
			case *FunctionResponseEvent:
				log := getLog(evt.FunctionID, evt.RequestID)
				log.WriteString("response " + evt.RequestID + "\n")
				log.WriteString(string(evt.Output))
				log.WriteString("\n")
				delete(logs, evt.RequestID)
			case *FunctionErrorEvent:
				getLog(evt.FunctionID, evt.RequestID).WriteString(evt.ErrorType + ": " + evt.ErrorMessage + "\n")
				delete(logs, evt.RequestID)
			}
		}
	}
}

func resolveAppSync(ctx context.Context, cfg aws.Config) (string, string, error) {
	client := appsyncSdk.NewFromConfig(cfg)
	var nextToken *string
	for {
		results, err := client.ListApis(ctx, &appsyncSdk.ListApisInput{
			NextToken: nextToken,
		})
		if err != nil {
			return "", "", err
		}
		for _, result := range results.Apis {
			if *result.Name == "sst" {
				match, err := client.GetApi(ctx, &appsyncSdk.GetApiInput{
					ApiId: result.ApiId,
				})
				if err != nil {
					return "", "", err
				}
				return match.Api.Dns["HTTP"], match.Api.Dns["REALTIME"], nil
			}
		}
		if results.NextToken == nil {
			break
		}
		nextToken = results.NextToken
	}
	api, err := client.CreateApi(ctx, &appsyncSdk.CreateApiInput{
		Name: aws.String("sst"),
		EventConfig: &appsyncTypes.EventConfig{
			AuthProviders: []appsyncTypes.AuthProvider{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			ConnectionAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			DefaultPublishAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			DefaultSubscribeAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
		},
	})
	if err != nil {
		return "", "", err
	}
	_, err = client.CreateChannelNamespace(ctx, &appsyncSdk.CreateChannelNamespaceInput{
		Name:  aws.String("sst"),
		ApiId: api.Api.ApiId,
		PublishAuthModes: []appsyncTypes.AuthMode{
			{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
			{AuthType: appsyncTypes.AuthenticationTypeApiKey},
		},
		SubscribeAuthModes: []appsyncTypes.AuthMode{
			{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
			{AuthType: appsyncTypes.AuthenticationTypeApiKey},
		},
	})
	if err != nil {
		return "", "", err
	}
	slog.Info("got api", "api", api.Api.Dns)
	return api.Api.Dns["HTTP"], api.Api.Dns["REALTIME"], nil
}
