package repository

import (
	"context"
	"fmt"
	"sst-go-lambda-dynamo/models"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

type DynamoUser struct {
	models.User
	PK   string `dynamodbav:"PK"`
	SK   string `dynamodbav:"SK"`
	TYPE string `dynamodbav:"TYPE"`
}

func getKey(id string) (map[string]types.AttributeValue, error) {
	return attributevalue.MarshalMap(map[string]string{
		"PK": "USER#" + id,
		"SK": "USER#" + id,
	})
}

func formatTo(u models.User) DynamoUser {
	return DynamoUser{
		User: u,
		PK:   "USER#" + u.ID,
		SK:   "USER#" + u.ID,
		TYPE: "USER",
	}
}

func formatFrom(item map[string]types.AttributeValue) (models.User, error) {
	var user models.User
	err := attributevalue.UnmarshalMap(item, &user)
	return user, err
}

type DynamoDBRepository struct {
	client    *dynamodb.Client
	tableName string
}

func NewDynamoDBRepository(client *dynamodb.Client, tableName string) UserRepository {
	return &DynamoDBRepository{
		client:    client,
		tableName: tableName,
	}
}

func (r *DynamoDBRepository) GetUser(ctx context.Context, id string) (*models.User, error) {
	key, err := getKey(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get key: %w", err)
	}
	output, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &r.tableName,
		Key:       key,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if output.Item == nil {
		return nil, fmt.Errorf("user not found")
	}

	user, err := formatFrom(output.Item)
	if err != nil {
		return nil, fmt.Errorf("failed to format user: %w", err)
	}

	return &user, nil
}

func (r *DynamoDBRepository) CreateUser(ctx context.Context, user models.UserCreate) (*models.User, error) {

	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("failed to generate id: %w", err)
	}
	now := time.Now()
	newUser := models.User{
		ID:        id.String(),
		Name:      user.Name,
		Email:     user.Email,
		CreatedAt: now,
		UpdatedAt: now,
	}

	dynamoUser := formatTo(newUser)
	item, err := attributevalue.MarshalMap(dynamoUser)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal user: %w", err)
	}
	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &r.tableName,
		Item:      item,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to put user: %w", err)
	}

	return &newUser, nil
}

func (r *DynamoDBRepository) DeleteUser(ctx context.Context, id string) error {
	key, err := getKey(id)
	if err != nil {
		return fmt.Errorf("failed to get key: %w", err)
	}

	_, err = r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: &r.tableName,
		Key:       key,
	})
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	return nil
}
