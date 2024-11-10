package aws

import (
	"context"
	"fmt"
	"net/rpc"

	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
)

type aws struct {
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

func Register(ctx context.Context, p *project.Project, r *rpc.Server) error {
	r.RegisterName("Provider.Aws", &aws{
		project: p,
	})
	return nil
}
