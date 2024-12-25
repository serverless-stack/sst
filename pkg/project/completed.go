package project

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/pulumi/pulumi/sdk/v3/go/auto"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/pulumi/pulumi/sdk/v3/go/common/tokens"
	"github.com/pulumi/pulumi/sdk/v3/go/common/workspace"
	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/project/common"
	"github.com/sst/sst/v3/pkg/project/provider"
)

func (p *Project) GetCompleted(ctx context.Context) (*CompleteEvent, error) {
	passphrase, err := provider.Passphrase(p.home, p.app.Name, p.app.Stage)
	if err != nil {
		return nil, err
	}
	workdir, err := p.NewWorkdir()
	if err != nil {
		return nil, err
	}
	defer workdir.Cleanup()
	_, err = workdir.Pull()
	if err != nil {
		return nil, err
	}
	defer workdir.Cleanup()
	pulumi, err := auto.NewPulumiCommand(&auto.PulumiCommandOptions{
		Root:             filepath.Join(global.BinPath(), ".."),
		SkipVersionCheck: true,
	})
	if err != nil {
		return nil, err
	}
	ws, err := auto.NewLocalWorkspace(ctx,
		auto.Pulumi(pulumi),
		auto.WorkDir(workdir.Backend()),
		auto.PulumiHome(global.ConfigDir()),
		auto.Project(workspace.Project{
			Name:    tokens.PackageName(p.app.Name),
			Runtime: workspace.NewProjectRuntimeInfo("nodejs", nil),
			Backend: &workspace.ProjectBackend{
				URL: fmt.Sprintf("file://%v", workdir.Backend()),
			},
		}),
		auto.EnvVars(
			map[string]string{
				"PULUMI_CONFIG_PASSPHRASE": passphrase,
			},
		),
	)
	if err != nil {
		return nil, err
	}
	stack, err := auto.SelectStack(ctx,
		p.app.Stage,
		ws,
	)
	if err != nil {
		return nil, err
	}
	return getCompletedEvent(ctx, stack)
}

func getCompletedEvent(ctx context.Context, stack auto.Stack) (*CompleteEvent, error) {
	exported, err := stack.Export(ctx)
	if err != nil {
		return nil, err
	}
	var deployment apitype.DeploymentV3
	json.Unmarshal(exported.Deployment, &deployment)
	complete := &CompleteEvent{
		Links:       common.Links{},
		Versions:    map[string]int{},
		ImportDiffs: map[string][]ImportDiff{},
		Devs:        Devs{},
		Tunnels:     map[string]Tunnel{},
		Hints:       map[string]string{},
		Outputs:     map[string]interface{}{},
		Tasks:       map[string]Task{},
		Errors:      []Error{},
		Finished:    false,
		Resources:   []apitype.ResourceV3{},
	}
	if len(deployment.Resources) == 0 {
		return complete, nil
	}
	complete.Resources = deployment.Resources

	for _, resource := range complete.Resources {
		outputs := decrypt(resource.Outputs).(map[string]interface{})
		if resource.URN.Type().Module().Package().Name() == "sst" {
			if resource.Type == "sst:sst:Version" {
				if outputs["target"] != nil && outputs["version"] != nil {
					complete.Versions[outputs["target"].(string)] = int(outputs["version"].(float64))
				}
			}

			if resource.Type != "sst:sst:Version" {
				name := resource.URN.Name()
				_, ok := complete.Versions[name]
				if !ok {
					complete.Versions[name] = 1
				}
			}
		}
		if match, ok := outputs["_dev"].(map[string]interface{}); ok {
			data, _ := json.Marshal(match)
			var entry Dev
			json.Unmarshal(data, &entry)
			entry.Name = resource.URN.Name()
			complete.Devs[entry.Name] = entry
		}

		if match, ok := outputs["_task"].(map[string]interface{}); ok {
			data, _ := json.Marshal(match)
			var entry Task
			json.Unmarshal(data, &entry)
			entry.Name = resource.URN.Name()
			complete.Tasks[entry.Name] = entry
		}

		if match, ok := outputs["_tunnel"].(map[string]interface{}); ok {
			tunnel := Tunnel{
				IP:         match["ip"].(string),
				Username:   match["username"].(string),
				PrivateKey: match["privateKey"].(string),
				Subnets:    []string{},
			}
			subnets, ok := match["subnets"].([]interface{})
			if ok {
				for _, subnet := range subnets {
					tunnel.Subnets = append(tunnel.Subnets, subnet.(string))
				}
				complete.Tunnels[resource.URN.Name()] = tunnel
			}
		}

		if hint, ok := outputs["_hint"].(string); ok {
			complete.Hints[string(resource.URN)] = hint
		}

		if resource.Type == "sst:sst:LinkRef" && outputs["target"] != nil && outputs["properties"] != nil {
			link := common.Link{
				Properties: outputs["properties"].(map[string]interface{}),
				Include:    []common.LinkInclude{},
			}
			if outputs["include"] != nil {
				for _, include := range outputs["include"].([]interface{}) {
					link.Include = append(link.Include, common.LinkInclude{
						Type:  include.(map[string]interface{})["type"].(string),
						Other: include.(map[string]interface{}),
					})
				}
			}
			complete.Links[outputs["target"].(string)] = link
		}
	}

	outputs := decrypt(deployment.Resources[0].Outputs).(map[string]interface{})
	for key, value := range outputs {
		if strings.HasPrefix(key, "_") {
			continue
		}
		complete.Outputs[key] = value
	}

	return complete, nil
}

func decrypt(input interface{}) interface{} {
	switch cast := input.(type) {
	case map[string]interface{}:
		if cast["plaintext"] != nil {
			var parsed any
			str, ok := cast["plaintext"].(string)
			if ok {
				json.Unmarshal([]byte(str), &parsed)
				return parsed
			}
			return cast["plaintext"]
		}
		for key, value := range cast {
			cast[key] = decrypt(value)
		}
		return cast
	case []interface{}:
		for i, value := range cast {
			cast[i] = decrypt(value)
		}
		return cast
	default:
		return cast
	}
}
