/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ## AWS Go Lambda Bucket Presigned URL
 *
 * Configure S3 Client and PresignedClient
 *
 * ```go title="main.go"
 * cfg, err := config.LoadDefaultConfig(context.TODO())
 * if err != nil {
 *    panic(err)
 * }
 *
 * client := s3.NewFromConfig(cfg)
 * presignedClient := s3.NewPresignClient(client)
 * ```
 *
 * Generate a presigned URL
 *
 * ```go title="main.go"
 * bucketName, err := resource.Get("Bucket", "name")
 * if err != nil {
 *   panic(err)
 * }
 * url, err := presignedClient.PresignPutObject(context.TODO(), &s3.PutObjectInput{
 *   Bucket: aws.String(bucket.(string)),
 *   Key:    aws.String(key),
 * })
 * ```
 */
export default $config({
  app(input) {
    return {
      name: "sst-v3-go-file-upload",
      removal: "remove",
      home: "aws",
    };
  },
  async run() {
    const bucket = new sst.aws.Bucket("Bucket");

    const api = new sst.aws.ApiGatewayV2("Api");

    api.route("GET /upload-url", {
      handler: "src/",
      runtime: "go",
      link: [bucket],
    });
  },
});
