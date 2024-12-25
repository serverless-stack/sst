package repository

import (
	"context"
	"sst-go-lambda-dynamo/models"
)

type UserRepository interface {
	GetUser(ctx context.Context, id string) (*models.User, error)
	CreateUser(ctx context.Context, user models.UserCreate) (*models.User, error)
	DeleteUser(ctx context.Context, id string) error
}
