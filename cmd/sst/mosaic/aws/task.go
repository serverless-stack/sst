package aws

import (
	"bufio"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ecs"
	"github.com/aws/aws-sdk-go-v2/service/ecs/types"
	"github.com/sst/sst/v3/cmd/sst/mosaic/aws/bridge"
	"github.com/sst/sst/v3/pkg/bus"
	"github.com/sst/sst/v3/pkg/process"
	"github.com/sst/sst/v3/pkg/project"
)

type TaskProvisionEvent struct {
	Name string
}

type TaskStartEvent struct {
	TaskID   string
	WorkerID string
	Command  string
}

type TaskLogEvent struct {
	TaskID   string
	WorkerID string
	Line     string
}

type TaskCompleteEvent struct {
	TaskID   string
	WorkerID string
}

func task(ctx context.Context, input input) {
	log := slog.Default().With("service", "aws.task")
	log.Info("starting")
	defer log.Info("done")
	events := bus.Subscribe(&project.CompleteEvent{})
	var complete *project.CompleteEvent

	ticker := time.NewTicker(time.Second * 3)
	defer ticker.Stop()

	ecsClient := ecs.NewFromConfig(input.config)
	trackedTasks := map[string]bool{}

	for {
		select {
		case <-ticker.C:
			if complete == nil || len(complete.Tasks) == 0 {
				continue
			}
			for _, item := range complete.Resources {
				if item.URN.Type() != "aws:ecs/cluster:Cluster" {
					continue
				}
				name := item.Outputs["name"]
				tasks, err := ecsClient.ListTasks(ctx, &ecs.ListTasksInput{
					Cluster:       aws.String(name.(string)),
					DesiredStatus: types.DesiredStatusRunning,
				})
				if err != nil {
					continue
				}
				dirty := []string{}
				for _, task := range tasks.TaskArns {
					if _, ok := trackedTasks[task]; !ok {
						dirty = append(dirty, task)
						trackedTasks[task] = true
						continue
					}
				}
				if len(dirty) == 0 {
					continue
				}
				log.Info("describing tasks", "tasks", dirty)
				described, err := ecsClient.DescribeTasks(ctx, &ecs.DescribeTasksInput{
					Tasks:   dirty,
					Cluster: aws.String(name.(string)),
				})
				if err != nil {
					continue
				}
				for _, item := range described.Tasks {
					bus.Publish(&TaskProvisionEvent{
						Name: *item.Containers[0].Name,
					})
					log.Info("task status", "status", *item.LastStatus, "desired", *item.LastStatus, "tags", item.Tags)
					if err != nil {
						continue
					}
				}
			}
			break

		case <-ctx.Done():
			return

		case msg := <-input.msg:
			if complete == nil {
				continue
			}
			switch msg.Type {
			case bridge.MessageTaskStart:
				log.Info("starting task", "task", task)
				body := bridge.TaskStartBody{}
				json.NewDecoder(msg.Body).Decode(&body)
				task, ok := complete.Tasks[body.TaskID]
				if !ok {
					continue
				}
				fields := strings.Fields(task.Command)
				cmd := process.Command(fields[0], fields[1:]...)
				cmd.Dir = task.Directory
				cmd.Env = body.Environment
				stdout, _ := cmd.StdoutPipe()
				stderr, _ := cmd.StderrPipe()
				go func() {
					scanner := bufio.NewScanner(stdout)
					for scanner.Scan() {
						line := scanner.Text()
						bus.Publish(&TaskLogEvent{
							TaskID:   body.TaskID,
							WorkerID: msg.Source,
							Line:     line,
						})
					}
				}()
				go func() {
					scanner := bufio.NewScanner(stderr)
					for scanner.Scan() {
						line := scanner.Text()
						bus.Publish(&TaskLogEvent{
							TaskID:   body.TaskID,
							WorkerID: msg.Source,
							Line:     line,
						})
					}
				}()
				go func() {
					done := make(chan struct{})
					cmd.Start()
					bus.Publish(&TaskStartEvent{
						TaskID:   body.TaskID,
						WorkerID: msg.Source,
						Command:  cmd.String(),
					})
					go func() {
						cmd.Wait()
						done <- struct{}{}
					}()
					for {
						writer := input.client.NewWriter(bridge.MessagePing, input.prefix+"/"+msg.Source+"/in")
						json.NewEncoder(writer).Encode(bridge.PingBody{})
						writer.Close()
						select {
						case <-done:
							writer := input.client.NewWriter(bridge.MessageTaskComplete, input.prefix+"/"+msg.Source+"/in")
							json.NewEncoder(writer).Encode(bridge.TaskCompleteBody{})
							writer.Close()
							bus.Publish(&TaskCompleteEvent{
								TaskID:   body.TaskID,
								WorkerID: msg.Source,
							})
							return
						case <-ctx.Done():
							return
						case <-time.After(time.Second * 5):
							continue
						}
					}
				}()
			}
			break

		case unknown := <-events:
			switch evt := unknown.(type) {
			case *project.CompleteEvent:
				complete = evt
			}
			break
		}
	}
}
