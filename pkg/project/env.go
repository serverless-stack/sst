package project

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/sst/sst/v3/pkg/project/provider"
)

func (p *Project) EnvFor(ctx context.Context, complete *CompleteEvent, name string) (map[string]string, error) {
	dev := complete.Devs[name]
	env := map[string]string{}
	if dev.Aws != nil && dev.Aws.Role != "" {
		prov, _ := p.Provider("aws")
		awsProvider := prov.(*provider.AwsProvider)
		stsClient := sts.NewFromConfig(awsProvider.Config())
		sessionName := "sst-dev"
		result, err := stsClient.AssumeRole(ctx, &sts.AssumeRoleInput{
			RoleArn:         &dev.Aws.Role,
			RoleSessionName: &sessionName,
			DurationSeconds: awssdk.Int32(3600),
		})
		if err == nil {
			env["AWS_ACCESS_KEY_ID"] = *result.Credentials.AccessKeyId
			env["AWS_SECRET_ACCESS_KEY"] = *result.Credentials.SecretAccessKey
			env["AWS_SESSION_TOKEN"] = *result.Credentials.SessionToken
			env["AWS_REGION"] = awsProvider.Config().Region
		}
	}
	slog.Info("dev", "links", dev.Links)
	for _, resource := range dev.Links {
		value := complete.Links[resource].Properties
		jsonValue, _ := json.Marshal(value)
		env["SST_RESOURCE_"+resource] = string(jsonValue)
	}
	env["SST_RESOURCE_App"] = fmt.Sprintf(`{"name": "%s", "stage": "%s" }`, p.App().Name, p.App().Stage)
	for key, value := range dev.Environment {
		env[key] = value
	}
	return env, nil
}
