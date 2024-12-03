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
	// bootstrapData, err := provider.AwsBootstrap(config)
	// if err != nil {
	// 	return err
	// }
	shutdownChan := make(chan MQTT.Message, 1000)
	prefix := fmt.Sprintf("/sst/%s/%s", p.App().Name, p.App().Stage)

	type WorkerInfo struct {
		FunctionID       string
		WorkerID         string
		Worker           runtime.Worker
		CurrentRequestID string
		Env              []string
	}

	type workerResponse struct {
		response     *http.Response
		responseBody *bytes.Buffer
		request      *http.Request
		requestBody  *bytes.Buffer
		workerID     string
	}

	workerResponseChan := make(chan workerResponse, 1000)
	workerShutdownChan := make(chan *WorkerInfo, 1000)
	evts := bus.Subscribe(&watcher.FileChangedEvent{}, &project.CompleteEvent{}, &runtime.BuildInput{})
	bootstrap, err := prov.Bootstrap(prov.Config().Region)
	if err != nil {
		return err
	}
	conn, err := appsync.Dial(ctx, config, bootstrap.AppsyncHttp, bootstrap.AppsyncRealtime)
	if err != nil {
		return err
	}
	pingChan, err := conn.Subscribe(ctx, prefix+"/ping")
	if err != nil {
		return err
	}
	exitChan, err := conn.Subscribe(ctx, prefix+"/exit")
	if err != nil {
		return err
	}
	client := bridge.NewClient(ctx, conn, prefix)

	go fileLogger(p)
	go func() {
		workers := map[string]*WorkerInfo{}
		workerEnv := map[string][]string{}
		builds := map[string]*runtime.BuildOutput{}
		targets := map[string]*runtime.BuildInput{}
		initChan := make(chan bridge.InitEvent, 1000)

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
			case init := <-initChan:
				if _, ok := targets[init.FunctionID]; !ok {
					go func() {
						slog.Info("dev not ready yet", "functionID", init.FunctionID)
						time.Sleep(time.Second * 1)
						initChan <- init
					}()
					continue
				}
				workerEnv[init.WorkerID] = init.Environment
				if ok := run(init.FunctionID, init.WorkerID); !ok {
					result, err := http.Post("http://"+server+init.WorkerID+"/runtime/init/error", "application/json", strings.NewReader(`{"errorMessage":"Function failed to build"}`))
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
						result, err := http.Get("http://" + server + init.WorkerID + "/runtime/invocation/next")
						if err != nil {
							continue
						}
						requestID := result.Header.Get("lambda-runtime-aws-request-id")
						result, err = http.Post("http://"+server+init.WorkerID+"/runtime/invocation/"+requestID+"/error", "application/json", strings.NewReader(`{"errorMessage":"Function failed to build"}`))
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
			case msg := <-pingChan:
				var ping bridge.PingEvent
				json.Unmarshal([]byte(msg), &ping)
				go conn.Publish(ctx, prefix+"/"+ping.WorkerID+"/ping", "ok")
				slog.Info("ping", "workerID", ping.WorkerID)
				_, exists := workers[ping.WorkerID]
				if exists {
					continue
				}
				go func(workerID string) {
					slog.Info("fetching init", "workerID", workerID)
					req, err := http.NewRequest("GET", "http://lambda/init", nil)
					if err != nil {
						return
					}
					slog.Info("--> " + req.URL.Path)
					resp, err := client.Do(ctx, ping.WorkerID, req)
					if err != nil {
						return
					}
					slog.Info("<-- " + resp.Status)
					init := bridge.InitEvent{}
					json.NewDecoder(resp.Body).Decode(&init)
					initChan <- init
				}(ping.WorkerID)

				break

			case evt := <-exitChan:
				var exit bridge.ExitEvent
				json.Unmarshal([]byte(evt), &exit)
				info, ok := workers[exit.WorkerID]
				if !ok {
					continue
				}
				info.Worker.Stop()
				continue
			case evt := <-workerResponseChan:
				info, ok := workers[evt.workerID]
				if !ok {
					continue
				}
				responseBody := evt.responseBody.Bytes()
				if err != nil {
					continue
				}
				splits := strings.Split(evt.request.URL.Path, "/")
				if splits[len(splits)-1] == "next" {
					info.CurrentRequestID = evt.response.Header.Get("lambda-runtime-aws-request-id")
					bus.Publish(&FunctionInvokedEvent{
						FunctionID: info.FunctionID,
						WorkerID:   info.WorkerID,
						RequestID:  info.CurrentRequestID,
						Input:      responseBody,
					})
				}
				if splits[len(splits)-1] == "response" {
					bus.Publish(&FunctionResponseEvent{
						FunctionID: info.FunctionID,
						WorkerID:   info.WorkerID,
						RequestID:  splits[len(splits)-2],
						Output:     evt.requestBody.Bytes(),
					})
				}
				if splits[len(splits)-1] == "error" {
					fee := &FunctionErrorEvent{
						FunctionID: info.FunctionID,
						WorkerID:   info.WorkerID,
						RequestID:  splits[len(splits)-2],
					}
					json.Unmarshal(evt.requestBody.Bytes(), &fee)
					bus.Publish(fee)
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
	s.Mux.HandleFunc(`/lambda/`, func(w http.ResponseWriter, r *http.Request) {
		var reqBuf bytes.Buffer
		r.Body = io.NopCloser(io.TeeReader(r.Body, &reqBuf))
		path := strings.Split(r.URL.Path, "/")
		workerID := path[2]
		slog.Info("lambda proxy --> " + r.URL.Path)
		req, _ := http.NewRequest(r.Method, "http://lambda/2018-06-01/"+strings.Join(path[3:], "/"), r.Body)
		resp, _ := client.Do(ctx, workerID, req)
		select {
		case <-r.Context().Done():
			slog.Info("lambda proxy xxx " + r.URL.Path + " " + resp.Status)
			return
		default:
		}
		slog.Info("lambda proxy <-- " + r.URL.Path + " " + resp.Status)
		for key, values := range resp.Header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(resp.StatusCode)
		var respBuf bytes.Buffer
		mw := io.MultiWriter(w, &respBuf)
		io.Copy(mw, resp.Body)
		workerResponseChan <- workerResponse{
			workerID:     workerID,
			response:     resp,
			responseBody: &respBuf,
			request:      req,
			requestBody:  &reqBuf,
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
