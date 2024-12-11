package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	appsyncSdk "github.com/aws/aws-sdk-go-v2/service/appsync"
	appsyncTypes "github.com/aws/aws-sdk-go-v2/service/appsync/types"
	"github.com/aws/aws-sdk-go-v2/service/ecr"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/aws/smithy-go"
	"github.com/sst/ion/internal/util"

	ecrTypes "github.com/aws/aws-sdk-go-v2/service/ecr/types"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	ssmTypes "github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

type AwsProvider struct {
	config         aws.Config
	profile        string
	credentials    sync.Once
	lock           sync.Mutex
	bootstrapCache map[string]*AwsBootstrapData
}

var ErrBucketMissing = errors.New("sst state bucket missing")

func NewAwsProvider() *AwsProvider {
	return &AwsProvider{
		bootstrapCache: map[string]*AwsBootstrapData{},
	}
}

func (a *AwsProvider) Env() (map[string]string, error) {
	creds, err := a.config.Credentials.Retrieve(context.Background())
	if err != nil {
		return nil, err
	}
	env := map[string]string{}
	env["SST_AWS_ACCESS_KEY_ID"] = creds.AccessKeyID
	env["SST_AWS_SECRET_ACCESS_KEY"] = creds.SecretAccessKey
	env["SST_AWS_SESSION_TOKEN"] = creds.SessionToken
	env["SST_AWS_REGION"] = a.config.Region
	if a.profile != "" {
		env["AWS_PROFILE"] = a.profile
	}
	return env, nil
}

func (a *AwsProvider) Init(app string, stage string, args map[string]interface{}) error {
	ctx := context.Background()
	if os.Getenv("SST_AWS_NO_PROFILE") != "" {
		delete(args, "profile")
	}
	if val, ok := args["profile"]; ok && val != "" {
		delete(args, "profile")
		// if profile is set in args it gets saved to the provider and always used for removing resources
		// this isn't ideal because people may use different profile names for the same stage
		// so we wipe it from args and put it in env which is not saved to the state
		a.profile = val.(string)
	}
	if value := os.Getenv("AWS_PROFILE"); value != "" {
		a.profile = value
	}

	cfg, err := config.LoadDefaultConfig(
		ctx,
		func(lo *config.LoadOptions) error {
			if a.profile != "" {
				lo.SharedConfigProfile = a.profile
			}
			if region, ok := args["region"].(string); ok && region != "" {
				lo.Region = region
				lo.DefaultRegion = "us-east-1"
			}
			return nil
		},
	)
	if err != nil {
		return err
	}
	if assumeRole, ok := args["assumeRole"].(map[string]interface{}); ok {
		stsclient := sts.NewFromConfig(cfg)
		cfg.Credentials = stscreds.NewAssumeRoleProvider(stsclient, assumeRole["roleArn"].(string), func(aro *stscreds.AssumeRoleOptions) {
			if sessionName, ok := assumeRole["sessionName"].(string); ok {
				aro.RoleSessionName = sessionName
			}
		})
	}
	_, err = cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return err
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	slog.Info("aws credentials found", "region", cfg.Region, "profile", a.profile)
	a.config = cfg
	defaultTags, ok := args["defaultTags"].(map[string]interface{})
	if !ok {
		defaultTags = map[string]interface{}{}
	}
	tags, ok := defaultTags["tags"].(map[string]interface{})
	if !ok {
		tags = map[string]interface{}{}
		defaultTags["tags"] = tags
	}
	tags["sst:app"] = app
	tags["sst:stage"] = stage
	args["defaultTags"] = defaultTags
	if args["region"] == nil {
		args["region"] = cfg.Region
	}
	_, err = a.Bootstrap(cfg.Region)
	if err != nil {
		return err
	}
	return nil
}

func (a *AwsProvider) Config() aws.Config {
	return a.config
}

func (p *AwsProvider) Bootstrap(region string) (*AwsBootstrapData, error) {
	p.lock.Lock()
	defer p.lock.Unlock()
	ctx := context.TODO()
	match, ok := p.bootstrapCache[region]
	if ok {
		return match, nil
	}
	cfg := p.config.Copy()
	cfg.Region = region
	ssmClient := ssm.NewFromConfig(cfg)
	bootstrapData := &AwsBootstrapData{}
	slog.Info("fetching bootstrap")
	result, err := ssmClient.GetParameter(ctx, &ssm.GetParameterInput{
		Name:           aws.String(SSM_NAME_BOOTSTRAP),
		WithDecryption: aws.Bool(false),
	})
	if result != nil && result.Parameter.Value != nil {
		slog.Info("found existing bootstrap", "data", *result.Parameter.Value)
		err = json.Unmarshal([]byte(*result.Parameter.Value), bootstrapData)
		if err != nil {
			return nil, err
		}
	}
	if err != nil {
		var pnf *ssmTypes.ParameterNotFound
		if !errors.As(err, &pnf) {
			return nil, err
		}
	}

	if len(steps) > bootstrapData.Version {
		for index, step := range steps {
			if bootstrapData.Version > index {
				continue
			}
			slog.Info("running bootstrap step", "step", index)
			err = step(ctx, cfg, bootstrapData)
			if err != nil {
				return nil, err
			}
		}
		bootstrapData.Version = len(steps)
		data, err := json.Marshal(bootstrapData)
		_, err = ssmClient.PutParameter(
			ctx,
			&ssm.PutParameterInput{
				Name:      aws.String(SSM_NAME_BOOTSTRAP),
				Type:      ssmTypes.ParameterTypeString,
				Overwrite: aws.Bool(true),
				Value:     aws.String(string(data)),
			},
		)
		if err != nil {
			return nil, err
		}
	}
	p.bootstrapCache[region] = bootstrapData
	return bootstrapData, nil
}
func (app *AwsProvider) ResolveAppSync(ctx context.Context) (string, string, error) {
	client := appsyncSdk.NewFromConfig(app.config)
	var nextToken *string
	for {
		results, err := client.ListApis(ctx, &appsyncSdk.ListApisInput{
			NextToken: nextToken,
		})
		if err != nil {
			return "", "", err
		}
		for _, result := range results.Apis {
			if *result.Name == "sst" {
				match, err := client.GetApi(ctx, &appsyncSdk.GetApiInput{
					ApiId: result.ApiId,
				})
				if err != nil {
					return "", "", err
				}
				return match.Api.Dns["HTTP"], match.Api.Dns["REALTIME"], nil
			}
		}
		if results.NextToken == nil {
			break
		}
		nextToken = results.NextToken
	}
	api, err := client.CreateApi(ctx, &appsyncSdk.CreateApiInput{
		Name: aws.String("sst"),
		EventConfig: &appsyncTypes.EventConfig{
			AuthProviders: []appsyncTypes.AuthProvider{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			ConnectionAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			DefaultPublishAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
			DefaultSubscribeAuthModes: []appsyncTypes.AuthMode{
				{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
				{AuthType: appsyncTypes.AuthenticationTypeApiKey},
			},
		},
	})
	if err != nil {
		return "", "", err
	}
	_, err = client.CreateChannelNamespace(ctx, &appsyncSdk.CreateChannelNamespaceInput{
		Name:  aws.String("sst"),
		ApiId: api.Api.ApiId,
		PublishAuthModes: []appsyncTypes.AuthMode{
			{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
			{AuthType: appsyncTypes.AuthenticationTypeApiKey},
		},
		SubscribeAuthModes: []appsyncTypes.AuthMode{
			{AuthType: appsyncTypes.AuthenticationTypeAwsIam},
			{AuthType: appsyncTypes.AuthenticationTypeApiKey},
		},
	})
	if err != nil {
		return "", "", err
	}
	slog.Info("got api", "api", api.Api.Dns)
	return api.Api.Dns["HTTP"], api.Api.Dns["REALTIME"], nil
}

type AwsBootstrapData struct {
	Version            int    `json:"version"`
	Asset              string `json:"asset"`
	AssetEcrRegistryId string `json:"assetEcrRegistryId"`
	AssetEcrUrl        string `json:"assetEcrUrl"`
	State              string `json:"state"`
	AppsyncHttp        string `json:"appsyncHttp"`
	AppsyncRealtime    string `json:"appsyncRealtime"`
}

type bootstrapStep = func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error

// never change these, only append more steps
var steps = []bootstrapStep{
	// Step: create the bootstrap bucket
	func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error {
		region := cfg.Region
		rand := util.RandomString(12)
		stateName := fmt.Sprintf("sst-state-%v", rand)
		assetName := fmt.Sprintf("sst-asset-%v", rand)
		slog.Info("creating bootstrap bucket", "name", assetName)
		s3Client := s3.NewFromConfig(cfg)

		var config *s3types.CreateBucketConfiguration = nil
		if region != "us-east-1" {
			config = &s3types.CreateBucketConfiguration{
				LocationConstraint: s3types.BucketLocationConstraint(region),
			}
		}
		_, err := s3Client.CreateBucket(context.TODO(), &s3.CreateBucketInput{
			Bucket:                    aws.String(assetName),
			CreateBucketConfiguration: config,
		})
		if err != nil {
			return err
		}

		_, err = s3Client.PutBucketNotificationConfiguration(context.TODO(), &s3.PutBucketNotificationConfigurationInput{
			Bucket:                    aws.String(assetName),
			NotificationConfiguration: &s3types.NotificationConfiguration{},
		})
		if err != nil {
			return err
		}

		_, err = s3Client.CreateBucket(context.TODO(), &s3.CreateBucketInput{
			Bucket:                    aws.String(stateName),
			CreateBucketConfiguration: config,
		})
		if err != nil {
			return err
		}

		_, err = s3Client.PutBucketVersioning(context.TODO(), &s3.PutBucketVersioningInput{
			Bucket: aws.String(stateName),
			VersioningConfiguration: &s3types.VersioningConfiguration{
				Status: s3types.BucketVersioningStatusEnabled,
			},
		})
		if err != nil {
			return err
		}
		data.Asset = assetName
		data.State = stateName

		return nil
	},

	// Step: create the bootstrap ECR repo
	func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error {
		ecrClient := ecr.NewFromConfig(cfg)
		repoName := "sst-asset"
		slog.Info("creating bootstrap ECR repo", "name", repoName)

		createRepoOutput, err := ecrClient.CreateRepository(ctx, &ecr.CreateRepositoryInput{
			RepositoryName: aws.String(repoName),
		})
		if err != nil {
			var repositoryAlreadyExists *ecrTypes.RepositoryAlreadyExistsException
			if !errors.As(err, &repositoryAlreadyExists) {
				return err
			}
			// Repository already exists, get the existing one
			describeRepoOutput, err := ecrClient.DescribeRepositories(ctx, &ecr.DescribeRepositoriesInput{
				RepositoryNames: []string{repoName},
			})
			if err != nil {
				return err
			}
			if len(describeRepoOutput.Repositories) > 0 {
				createRepoOutput = &ecr.CreateRepositoryOutput{
					Repository: &describeRepoOutput.Repositories[0],
				}
			} else {
				return fmt.Errorf("failed to find existing ECR repository: %s", repoName)
			}
		}

		if createRepoOutput.Repository != nil {
			data.AssetEcrRegistryId = aws.ToString(createRepoOutput.Repository.RegistryId)
			data.AssetEcrUrl = aws.ToString(createRepoOutput.Repository.RepositoryUri)
		} else {
			return fmt.Errorf("failed to create or find ECR repository: %s", repoName)
		}

		return nil
	},

	// Step: previously components code used to bootstrap separately. This step is to cleanup
	// the old bootstrap
	func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error {
		slog.Info("cleaning up old bootstrap bucket", "name", data.Asset)
		ssmClient := ssm.NewFromConfig(cfg)
		s3Client := s3.NewFromConfig(cfg)

		// Attempt to get the SSM parameter
		ssmKey := "/sst/bootstrap/asset"
		getParamOutput, err := ssmClient.GetParameter(ctx, &ssm.GetParameterInput{
			Name: aws.String(ssmKey),
		})
		if err != nil {
			var paramNotFound *ssmTypes.ParameterNotFound
			if errors.As(err, &paramNotFound) {
				// Parameter doesn't exist, nothing to do
				return nil
			}
			return err
		}

		// Parameter exists, decode the value
		var value struct {
			Bucket string `json:"bucket"`
		}
		if err := json.Unmarshal([]byte(*getParamOutput.Parameter.Value), &value); err != nil {
			return fmt.Errorf("failed to decode SSM parameter value: %w", err)
		}

		if value.Bucket != "" && value.Bucket != data.Asset {
			// Empty the current asset bucket
			var continuationToken *string
			for {
				listObjectsInput := &s3.ListObjectsV2Input{
					Bucket: aws.String(data.Asset),
				}
				if continuationToken != nil {
					listObjectsInput.ContinuationToken = continuationToken
				}

				listObjectsOutput, err := s3Client.ListObjectsV2(ctx, listObjectsInput)
				if err != nil {
					if strings.Contains(err.Error(), "NoSuchBucket") {
						break
					}
					return err
				}

				if len(listObjectsOutput.Contents) == 0 {
					break
				}

				objectIdentifiers := make([]s3types.ObjectIdentifier, len(listObjectsOutput.Contents))
				for i, object := range listObjectsOutput.Contents {
					objectIdentifiers[i] = s3types.ObjectIdentifier{Key: object.Key}
				}

				_, err = s3Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
					Bucket: aws.String(data.Asset),
					Delete: &s3types.Delete{Objects: objectIdentifiers},
				})
				if err != nil {
					return err
				}

				if listObjectsOutput.IsTruncated == nil || !*listObjectsOutput.IsTruncated {
					break
				}
				continuationToken = listObjectsOutput.NextContinuationToken
			}

			// Remove the previously created S3 bucket
			_, err := s3Client.DeleteBucket(ctx, &s3.DeleteBucketInput{
				Bucket: aws.String(data.Asset),
			})
			if err != nil {
				if !strings.Contains(err.Error(), "NoSuchBucket") {
					return fmt.Errorf("failed to delete S3 bucket %s: %w", data.Asset, err)
				}
			}

			// Assign the new bucket name
			data.Asset = value.Bucket
		}

		// Remove the SSM parameter
		_, err = ssmClient.DeleteParameter(ctx, &ssm.DeleteParameterInput{
			Name: aws.String(ssmKey),
		})
		if err != nil {
			return fmt.Errorf("failed to delete SSM parameter %s: %w", ssmKey, err)
		}

		return nil
	},

	// Step: enforce bucket requests to use SSL
	func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error {
		s3Client := s3.NewFromConfig(cfg)

		// set partition based on region
		partition := "aws"
		if strings.HasPrefix(cfg.Region, "cn-") {
			partition = "aws-cn"
		} else if strings.HasPrefix(cfg.Region, "us-gov-") {
			partition = "aws-us-gov"
		}

		buckets := []string{data.Asset, data.State}
		for _, bucket := range buckets {
			slog.Info("enforcing SSL for bucket", "name", bucket)
			policy := map[string]interface{}{
				"Version": "2012-10-17",
				"Statement": []map[string]interface{}{
					{
						"Sid":       "EnforceSSLRequests",
						"Effect":    "Deny",
						"Principal": "*",
						"Action":    "s3:*",
						"Resource": []string{
							fmt.Sprintf("arn:%s:s3:::%s", partition, bucket),
							fmt.Sprintf("arn:%s:s3:::%s/*", partition, bucket),
						},
						"Condition": map[string]interface{}{
							"Bool": map[string]interface{}{
								"aws:SecureTransport": "false",
							},
						},
					},
				},
			}

			policyJSON, err := json.Marshal(policy)
			if err != nil {
				return fmt.Errorf("failed to marshal policy for bucket %s: %w", bucket, err)
			}

			_, err = s3Client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
				Bucket: aws.String(bucket),
				Policy: aws.String(string(policyJSON)),
			})
			if err != nil {
				return fmt.Errorf("failed to put bucket policy for %s: %w", bucket, err)
			}
		}

		return nil
	},

	// Step: add appsync events apis for live lambda - we no longer do this
	func(ctx context.Context, cfg aws.Config, data *AwsBootstrapData) error {
		return nil
	},
}

type AwsHome struct {
	provider *AwsProvider
}

func NewAwsHome(provider *AwsProvider) *AwsHome {
	return &AwsHome{
		provider: provider,
	}
}

func (a *AwsHome) pathForData(key, app, stage string) string {
	return path.Join(key, app, fmt.Sprintf("%v.json", stage))
}

func (a *AwsHome) pathForPassphrase(app string, stage string) string {
	return "/" + strings.Join([]string{"sst", "passphrase", app, stage}, "/")
}

func (a *AwsHome) getData(key, app, stage string) (io.Reader, error) {
	bootstrap, err := a.provider.Bootstrap(a.provider.config.Region)
	if err != nil {
		return nil, err
	}
	s3Client := s3.NewFromConfig(a.provider.config)

	result, err := s3Client.GetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(bootstrap.State),
		Key:    aws.String(a.pathForData(key, app, stage)),
	})
	if err != nil {
		var apiErr smithy.APIError
		if errors.As(err, &apiErr) {
			if apiErr.ErrorCode() == "NoSuchBucket" {
				return nil, ErrBucketMissing
			}
		}
		var nsk *s3types.NoSuchKey
		if errors.As(err, &nsk) {
			return nil, nil
		}
		return nil, err
	}
	return result.Body, nil
}

func (a *AwsHome) putData(key, app, stage string, data io.Reader) error {
	bootstrap, err := a.provider.Bootstrap(a.provider.config.Region)
	if err != nil {
		return err
	}
	s3Client := s3.NewFromConfig(a.provider.config)

	_, err = s3Client.PutObject(context.TODO(), &s3.PutObjectInput{
		Bucket:      aws.String(bootstrap.State),
		Key:         aws.String(a.pathForData(key, app, stage)),
		Body:        data,
		ContentType: aws.String("application/json"),
	})
	if err != nil {
		return err
	}

	return nil
}

func (a *AwsHome) removeData(key, app, stage string) error {
	bootstrap, err := a.provider.Bootstrap(a.provider.config.Region)
	if err != nil {
		return err
	}
	s3Client := s3.NewFromConfig(a.provider.config)

	_, err = s3Client.DeleteObject(context.TODO(), &s3.DeleteObjectInput{
		Bucket: aws.String(bootstrap.State),
		Key:    aws.String(a.pathForData(key, app, stage)),
	})
	if err != nil {
		return err
	}

	return nil
}

func (a *AwsHome) getPassphrase(app string, stage string) (string, error) {
	ssmClient := ssm.NewFromConfig(a.provider.config)

	result, err := ssmClient.GetParameter(context.TODO(), &ssm.GetParameterInput{
		Name:           aws.String(a.pathForPassphrase(app, stage)),
		WithDecryption: aws.Bool(true),
	})
	if err != nil {
		pnf := &ssmTypes.ParameterNotFound{}
		if errors.As(err, &pnf) {
			return "", nil
		}

		return "", err
	}
	return *result.Parameter.Value, nil
}

func (a *AwsHome) setPassphrase(app, stage, passphrase string) error {
	ssmClient := ssm.NewFromConfig(a.provider.config)

	_, err := ssmClient.PutParameter(context.TODO(), &ssm.PutParameterInput{
		Name:        aws.String(a.pathForPassphrase(app, stage)),
		Type:        ssmTypes.ParameterTypeSecureString,
		Value:       aws.String(passphrase),
		Description: aws.String("DO NOT DELETE STATE WILL BECOME UNRECOVERABLE"),
		Overwrite:   aws.Bool(false),
	})
	return err
}

func (a *AwsHome) Bootstrap() error {
	_, err := a.provider.Bootstrap(a.provider.config.Region)
	if err != nil {
		return err
	}
	return err
}
