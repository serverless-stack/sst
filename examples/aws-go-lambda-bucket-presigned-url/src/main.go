package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/google/uuid"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

type App struct {
	client          *s3.Client
	presignedClient *s3.PresignClient
	bucketName      string
}

func NewApp() *App {
	cfg, err := config.LoadDefaultConfig(context.Background(), func(opts *config.LoadOptions) error {
		opts.Region = os.Getenv("AWS_REGION")
		return nil
	})
	if err != nil {
		panic(err)
	}
	client := s3.NewFromConfig(cfg)
	presignedClient := s3.NewPresignClient(client)

	bucketName, err := resource.Get("Bucket", "name")
	if err != nil {
		panic(err)
	}

	return &App{
		client:          client,
		presignedClient: presignedClient,
		bucketName:      bucketName.(string),
	}
}

func (app *App) handler(ctx context.Context, r events.APIGatewayV2HTTPRequest) (events.APIGatewayV2HTTPResponse, error) {

	filename := r.QueryStringParameters["filename"]
	filetype := r.QueryStringParameters["filetype"]

	id := uuid.New()
	key := fmt.Sprintf("%s-%s", id, filename)

	url, err := app.presignedClient.PresignPutObject(context.Background(), &s3.PutObjectInput{
		Bucket:      aws.String(app.bucketName),
		Key:         aws.String(key),
		ContentType: aws.String(filetype),
	}, func(opts *s3.PresignOptions) {
		opts.Expires = 600 * time.Second // 10 minutes
	})

	if err != nil {
		return apiErrorResponse(http.StatusInternalServerError, "Internal Server Error"), nil
	}

	var response struct {
		URL string `json:"url"`
	}
	response.URL = url.URL
	body, err := json.Marshal(response)
	if err != nil {
		return apiErrorResponse(http.StatusInternalServerError, "Internal Server Error"), nil
	}

	return events.APIGatewayV2HTTPResponse{
		StatusCode: http.StatusOK,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(body),
	}, nil

}

func main() {
	app := NewApp()
	lambda.Start(app.handler)
}

func apiErrorResponse(statusCode int, message string) events.APIGatewayV2HTTPResponse {
	body, _ := json.Marshal(map[string]string{"message": message})
	return events.APIGatewayV2HTTPResponse{
		StatusCode: statusCode,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(body),
	}
}
