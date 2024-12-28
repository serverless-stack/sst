FROM golang:1.23.4 as builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o main

FROM alpine
LABEL org.opencontainers.image.source https://github.com/sst/sst
WORKDIR /app
COPY --from=builder /app/main /app/main
CMD /app/main
