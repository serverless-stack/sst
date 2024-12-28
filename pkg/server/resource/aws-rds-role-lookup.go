package resource

import (
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	"github.com/aws/aws-sdk-go-v2/service/iam/types"
)

type RdsRoleLookup struct {
	*AwsResource
}

type RdsRoleLookupInputs struct {
	Name string `json:"name"`
}

type RdsRoleLookupOutputs struct {
}

func (r *RdsRoleLookup) Create(input *RdsRoleLookupInputs, output *CreateResult[RdsRoleLookupOutputs]) error {
	err := r.handle(input)
	if err != nil {
		return err
	}
	*output = CreateResult[RdsRoleLookupOutputs]{
		ID:   "lookup",
		Outs: RdsRoleLookupOutputs{},
	}
	return nil
}

func (r *RdsRoleLookup) Update(input *UpdateInput[RdsRoleLookupInputs, RdsRoleLookupOutputs], output *UpdateResult[RdsRoleLookupOutputs]) error {
	err := r.handle(&input.News)
	if err != nil {
		return err
	}

	*output = UpdateResult[RdsRoleLookupOutputs]{
		Outs: RdsRoleLookupOutputs{},
	}
	return nil
}

func (r *RdsRoleLookup) handle(input *RdsRoleLookupInputs) (error) {
	cfg, err := r.config()
	if err != nil {
		return err
	}
	client := iam.NewFromConfig(cfg)

	start := time.Now()
	timeout := 5 * time.Minute

	for {
		_, err := client.GetRole(r.context, &iam.GetRoleInput{
			RoleName: aws.String(input.Name),
		})

		if err == nil {
			fmt.Println("found role", input.Name)
			return nil
		}

		// if error is not a NoSuchEntityException, return error
		var noSuchEntityErr *types.NoSuchEntityException
		if !errors.As(err, &noSuchEntityErr) {
			return err
		}

		if time.Since(start) > timeout {
			return fmt.Errorf("The IAM role \"%s\" cannot be found in your AWS account. This role should exist in every AWS account and is used by AWS RDS to create the RDS Proxy. However if you are using RDS for the first time, this role might not be created yet. Wait for a few minutes and try again.", input.Name)
		}

		time.Sleep(5 * time.Second)
	}
}

