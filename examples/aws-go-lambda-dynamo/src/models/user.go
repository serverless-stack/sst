package models

import (
	"time"
)

type User struct {
	ID        string    `json:"id" dynamodbav:"id"`
	Name      string    `json:"name" dynamodbav:"name"`
	Email     string    `json:"email" dynamodbav:"email"`
	CreatedAt time.Time `json:"created_at" dynamodbav:"created_at"`
	UpdatedAt time.Time `json:"updated_at" dynamodbav:"updated_at"`
}

type UserCreate struct {
	Name  string
	Email string
}
