/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## Go ApiGatewayV2
 *
 * Uses [aws-lambda-go-api-proxy](https://github.com/awslabs/aws-lambda-go-api-proxy/tree/master) to allow you to run a Go API with API Gateway V2.
 *
 * :::info
 * You write your Go code as normal and use the `aws-lambda-go-api-proxy` package to handle the API Gateway V2 event.
 * :::
 *
 * ```go title="main.go"
 * import (
 *  "github.com/aws/aws-lambda-go/lambda"
 *  "github.com/awslabs/aws-lambda-go-api-proxy/httpadapter"
 * )
 *
 * func router() *http.ServeMux {
 *   mux := http.NewServeMux()
 *
 *   mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
 *     w.Header().Set("Content-Type", "application/json")
 *     w.WriteHeader(http.StatusOK)
 *     w.Write([]byte(`{"message": "hello world"}`))
 *   })
 *
 *   return mux
 * }
 *
 * func main() {
 *   lambda.Start(httpadapter.NewV2(router()).ProxyWithContext)
 * }
 * ```
 *
 */
export default $config({
  app(input) {
    return {
      name: "sst-v3-go-api",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const api = new sst.aws.ApiGatewayV2("GoApi", {});
    api.route("$default", {
      handler: "src/",
      runtime: "go",
    });
  },
});
