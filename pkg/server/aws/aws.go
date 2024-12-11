package aws

import (
	"context"
	"fmt"
	"net/rpc"
	"sync"

	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
)

type aws struct {
	sync.Mutex
	project *project.Project
}

type BootstrapInput struct {
	Region string `json:"region"`
}

func (a *aws) Bootstrap(input *BootstrapInput, output *provider.AwsBootstrapData) error {
	unknown, ok := a.project.Provider("aws")
	if !ok {
		return fmt.Errorf("aws provider not found")
	}
	existing := unknown.(*provider.AwsProvider)
	data, err := existing.Bootstrap(input.Region)
	if err != nil {
		return err
	}
	*output = *data
	return nil
}

type AppsyncInput struct {
}
type AppsyncOutput struct {
	Http     string `json:"http"`
	Realtime string `json:"realtime"`
}

func (a *aws) Appsync(input *AppsyncInput, output *AppsyncOutput) error {
	unknown, ok := a.project.Provider("aws")
	if !ok {
		return fmt.Errorf("aws provider not found")
	}
	existing := unknown.(*provider.AwsProvider)
	http, realtime, err := existing.ResolveAppSync(context.Background())
	if err != nil {
		return err
	}
	output.Http = http
	output.Realtime = realtime
	return nil
}

func Register(ctx context.Context, p *project.Project, r *rpc.Server) error {
	r.RegisterName("Provider.Aws", &aws{
		project: p,
	})
	return nil
}
