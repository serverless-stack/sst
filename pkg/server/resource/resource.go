package resource

import (
	"context"
	"fmt"
	"net/rpc"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/sst/ion/pkg/project"
	"github.com/sst/ion/pkg/project/provider"
)

type ReadInput[T any] struct {
	ID   string `json:"id"`
}

type ReadResult[T any] struct {
	ID   string `json:"id"`
	Outs T      `json:"outs"`
}

type CreateResult[T any] struct {
	ID   string `json:"id"`
	Outs T      `json:"outs"`
}

type UpdateResult[T any] struct {
	Outs T `json:"outs"`
}

type DeleteInput[T any] struct {
	ID   string `json:"id"`
	Outs T      `json:"outs"`
}

type UpdateInput[N any, O any] struct {
	ID   string `json:"id"`
	News N      `json:"news"`
	Olds O      `json:"olds"`
}

type AwsResource struct {
	context context.Context
	project *project.Project
}

func (a *AwsResource) config() (aws.Config, error) {
	result, ok := a.project.Provider("aws")
	if !ok {
		return aws.Config{}, fmt.Errorf("no aws provider found")
	}
	casted := result.(*provider.AwsProvider)
	return casted.Config(), nil
}

func Register(ctx context.Context, p *project.Project, r *rpc.Server) error {
	awsResource := &AwsResource{ctx, p}
	r.RegisterName("Resource.Run", NewRun())
	r.RegisterName("Resource.Aws.BucketFiles", &BucketFiles{awsResource})
	r.RegisterName("Resource.Aws.DistributionDeploymentWaiter", &DistributionDeploymentWaiter{awsResource})
	r.RegisterName("Resource.Aws.DistributionInvalidation", &DistributionInvalidation{awsResource})
	r.RegisterName("Resource.Aws.FunctionCodeUpdater", &FunctionCodeUpdater{awsResource})
	r.RegisterName("Resource.Aws.HostedZoneLookup", &HostedZoneLookup{awsResource})
	r.RegisterName("Resource.Aws.OriginAccessIdentity", &OriginAccessIdentity{awsResource})
	r.RegisterName("Resource.Aws.OriginAccessControl", &OriginAccessControl{awsResource})
	r.RegisterName("Resource.Aws.RdsRoleLookup", &RdsRoleLookup{awsResource})
	r.RegisterName("Resource.Aws.VectorTable", &VectorTable{awsResource})
	return nil
}
