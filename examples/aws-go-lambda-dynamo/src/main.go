package main

import (
	"context"
	"net/http"
	"os"
	"sst-go-lambda-dynamo/handlers"
	"sst-go-lambda-dynamo/repository"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/sst/sst/v3/sdk/golang/resource"
)

type App struct {
	handlers *handlers.Handlers
}

func NewApp() *App {
	cfg, err := config.LoadDefaultConfig(context.Background(), func(opts *config.LoadOptions) error {
		opts.Region = os.Getenv("AWS_REGION")
		return nil
	})
	if err != nil {
		panic(err)
	}
	client := dynamodb.NewFromConfig(cfg)

	tableName, err := resource.Get("Table", "name")
	if err != nil {
		panic(err)
	}

	userRepo := repository.NewDynamoDBRepository(client, tableName.(string))
	handlers := handlers.NewHandlers(userRepo)

	return &App{handlers: handlers}
}

func (app *App) handler(ctx context.Context, r events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	switch r.RequestContext.HTTP.Method {
	case http.MethodGet:
		return app.handlers.GetUser(ctx, r)
	case http.MethodPost:
		return app.handlers.CreateUser(ctx, r)
	case http.MethodDelete:
		return app.handlers.DeleteUser(ctx, r)
	default:
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusMethodNotAllowed,
			Headers:    map[string]string{"Content-Type": "application/json"},
			Body:       `{"message": "Method Not Allowed"}`,
		}, nil
	}
}

func main() {
	app := NewApp()
	lambda.Start(app.handler)
}
