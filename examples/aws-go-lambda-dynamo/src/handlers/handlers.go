package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"sst-go-lambda-dynamo/models"
	"sst-go-lambda-dynamo/repository"

	"github.com/aws/aws-lambda-go/events"
)

type Handlers struct {
	userRepo repository.UserRepository
}

func NewHandlers(userRepo repository.UserRepository) *Handlers {
	return &Handlers{userRepo: userRepo}
}

func (h *Handlers) GetUser(ctx context.Context, r events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {

	queryString := r.QueryStringParameters
	if queryString == nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusBadRequest,
			Body:       `{"message": "Missing query string"}`,
		}, nil
	}

	id := queryString["id"]

	user, err := h.userRepo.GetUser(ctx, id)
	if err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusNotFound,
			Body:       `{"message": "User not found"}`,
		}, nil
	}

	userJSON, err := json.Marshal(user)
	if err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"message": "Failed to marshal user"}`,
		}, err
	}

	return events.LambdaFunctionURLResponse{
		StatusCode: http.StatusOK,
		Body:       string(userJSON),
	}, nil
}

type PostUserRequestData struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (h *Handlers) CreateUser(ctx context.Context, r events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {

	var data PostUserRequestData
	if err := json.Unmarshal([]byte(r.Body), &data); err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: 400,
			Body:       `{"message": "Invalid request body"}`,
		}, err
	}

	user, err := h.userRepo.CreateUser(ctx, models.UserCreate{
		Name:  data.Name,
		Email: data.Email,
	})
	if err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: 500,
			Body:       `{"message": "Failed to create user"}`,
		}, err
	}

	userJSON, err := json.Marshal(user)
	if err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: 500,
			Body:       `{"message": "Failed to marshal user"}`,
		}, err
	}

	return events.LambdaFunctionURLResponse{
		StatusCode: 201,
		Body:       string(userJSON),
	}, nil
}

func (h *Handlers) DeleteUser(ctx context.Context, r events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {

	queryString := r.QueryStringParameters
	if queryString == nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusBadRequest,
			Body:       `{"message": "Missing query string"}`,
		}, nil
	}

	id := queryString["id"]

	if err := h.userRepo.DeleteUser(ctx, id); err != nil {
		return events.LambdaFunctionURLResponse{
			StatusCode: http.StatusInternalServerError,
			Body:       `{"message": "Failed to delete user"}`,
		}, err
	}

	return events.LambdaFunctionURLResponse{
		StatusCode: http.StatusOK,
		Body:       `{"message": "User deleted"}`,
	}, nil
}
