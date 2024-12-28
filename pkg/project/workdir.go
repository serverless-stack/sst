package project

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/sst/sst/v3/pkg/id"
	"github.com/sst/sst/v3/pkg/project/provider"
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
