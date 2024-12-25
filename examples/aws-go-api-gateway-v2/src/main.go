package main

import (
	"encoding/json"
	"net/http"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
)

func respondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	encoder := json.NewEncoder(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	encoder.Encode(payload)

}

func router() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "hello world"})
		return
	})
	mux.HandleFunc("/my-ping", func(w http.ResponseWriter, r *http.Request) {
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "pong"})
		return
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		respondWithJSON(w, http.StatusNotFound, map[string]string{"message": "not found"})
		return
	})
	mux.HandleFunc("/{$}", func(w http.ResponseWriter, r *http.Request) {
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "home page"})
	})

	return mux
}

func main() {

	lambda.Start(httpadapter.NewV2(router()).ProxyWithContext)

}
