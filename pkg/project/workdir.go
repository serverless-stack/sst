package project

import (
	"encoding/json"
	"fmt"
	"github.com/pulumi/pulumi/sdk/v3/go/common/apitype"
	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/project/provider"
	"os"
	"path/filepath"
)

type PulumiWorkdir struct {
	path    string
	project *Project
}

func (p *Project) NewWorkdir() (*PulumiWorkdir, error) {
	workdir := PulumiWorkdir{
		path:    filepath.Join(p.PathWorkingDir(), "pulumi", id.Descending()),
		project: p,
	}
	err := os.MkdirAll(workdir.path, 0755)
	if err != nil {
		return nil, err
	}
	return &workdir, nil
}

func (w *PulumiWorkdir) Cleanup() {
	os.RemoveAll(w.path)
}

func (w *PulumiWorkdir) Push(updateID string) error {
	stage := w.project.app.Stage
	app := w.project.app.Name
	return provider.PushState(
		w.project.home,
		updateID,
		app,
		stage,
		filepath.Join(w.Backend(), ".pulumi", "stacks", app, fmt.Sprintf("%v.json", stage)),
	)
}

func (w *PulumiWorkdir) Pull() (string, error) {
	appDir := filepath.Join(w.path, ".pulumi", "stacks", w.project.app.Name)
	path := filepath.Join(appDir, fmt.Sprintf("%v.json", w.project.app.Stage))

	err := os.MkdirAll(appDir, 0755)
	if err != nil {
		return path, err
	}
	err = provider.PullState(
		w.project.home,
		w.project.app.Name,
		w.project.app.Stage,
		path,
	)
	if err != nil {
		return path, err
	}
	return path, nil
}

func (w *PulumiWorkdir) Backend() string {
	return w.path
}

func (w *PulumiWorkdir) state() string {
	appDir := filepath.Join(w.path, ".pulumi", "stacks", w.project.app.Name)
	path := filepath.Join(appDir, fmt.Sprintf("%v.json", w.project.app.Stage))
	return path
}

func (w *PulumiWorkdir) Export() (*apitype.CheckpointV3, error) {
	var untyped apitype.VersionedCheckpoint
	file, err := os.Open(w.state())
	if err != nil {
		return nil, err
	}
	err = json.NewDecoder(file).Decode(&untyped)
	if err != nil {
		return nil, err
	}

	var result apitype.CheckpointV3
	err = json.Unmarshal(untyped.Checkpoint, &result)
	if err != nil {
		return nil, err
	}

	return &result, nil
}

func (w *PulumiWorkdir) Import(checkpoint *apitype.CheckpointV3) error {
	raw, err := json.MarshalIndent(checkpoint, "", "  ")
	if err != nil {
		return err
	}
	result := apitype.VersionedCheckpoint{
		Version:    3,
		Checkpoint: raw,
	}
	file, err := os.Create(w.state())
	if err != nil {
		return err
	}
	enc := json.NewEncoder(file)
	enc.SetIndent("", "  ")
	err = enc.Encode(result)
	if err != nil {
		return err
	}
	return nil
}
