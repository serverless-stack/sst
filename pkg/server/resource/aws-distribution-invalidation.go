package resource

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront/types"
)

const (
	FILE_LIMIT     = 3000
	WILDCARD_LIMIT = 15
)

type DistributionInvalidation struct {
	*AwsResource
}

type DistributionInvalidationInputs struct {
	DistributionId string   `json:"distributionId"`
	Paths          []string `json:"paths"`
	Wait           bool     `json:"wait"`
	Version        string   `json:"version"`
}

func (r *DistributionInvalidation) Create(input *DistributionInvalidationInputs, output *CreateResult[struct{}]) error {
	if err := r.handle(input); err != nil {
		return err
	}
	*output = CreateResult[struct{}]{
		ID: "invalidation",
	}
	return nil
}

func (r *DistributionInvalidation) Update(input *UpdateInput[DistributionInvalidationInputs, struct{}], output *UpdateResult[struct{}]) error {
	if err := r.handle(&input.News); err != nil {
		return err
	}
	*output = UpdateResult[struct{}]{}
	return nil
}

func (r *DistributionInvalidation) handle(input *DistributionInvalidationInputs) error {
	cfg, err := r.config()
	if err != nil {
		return err
	}
	client := cloudfront.NewFromConfig(cfg)

	// Split paths into chunks
	var pathsFile, pathsWildcard []string
	for _, path := range input.Paths {
		if strings.TrimSpace(path)[len(path)-1:] == "*" {
			pathsWildcard = append(pathsWildcard, path)
		} else {
			pathsFile = append(pathsFile, path)
		}
	}

	fileCount := len(pathsFile)
	wildcardCount := len(pathsWildcard)
	stepsCount := int(math.Max(
		math.Ceil(float64(fileCount)/FILE_LIMIT),
		math.Ceil(float64(wildcardCount)/WILDCARD_LIMIT),
	))

	// Invalidate each chunk
	for i := 0; i < stepsCount; i++ {
		fileStart := int(math.Min(float64(i*FILE_LIMIT), float64(fileCount)))
		fileEnd := int(math.Min(float64((i+1)*FILE_LIMIT), float64(fileCount)))
		wildcardStart := int(math.Min(float64(i*WILDCARD_LIMIT), float64(wildcardCount)))
		wildcardEnd := int(math.Min(float64((i+1)*WILDCARD_LIMIT), float64(wildcardCount)))
		stepPaths := append(pathsFile[fileStart:fileEnd], pathsWildcard[wildcardStart:wildcardEnd]...)

		result, err := client.CreateInvalidation(r.context, &cloudfront.CreateInvalidationInput{
			DistributionId: aws.String(input.DistributionId),
			InvalidationBatch: &types.InvalidationBatch{
				CallerReference: aws.String(strconv.FormatInt(time.Now().UnixNano(), 10)),
				Paths: &types.Paths{
					Quantity: aws.Int32(int32(len(stepPaths))),
					Items:    stepPaths,
				},
			},
		})
		if err != nil {
			return err
		}

		if result.Invalidation == nil || result.Invalidation.Id == nil {
			return fmt.Errorf("Invalidation ID not found")
		}

		// Have to wait for invalidation if there are multiple steps
		if input.Wait || stepsCount > 1 {
			waiter := cloudfront.NewInvalidationCompletedWaiter(client)
			err := waiter.Wait(r.context, &cloudfront.GetInvalidationInput{
				DistributionId: aws.String(input.DistributionId),
				Id:             aws.String(*result.Invalidation.Id),
			}, 10*time.Minute)
			if err != nil {
				// Suppress errors
				// log.Printf("Error waiting for invalidation: %v", err)
			}
		}
	}

	return nil
}