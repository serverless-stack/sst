import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { createYoga, YogaServerOptions } from "graphql-yoga";

type ServerContext = {
  event: APIGatewayProxyEventV2;
  context: Context;
};

export function awsLambdaRequestHandler<UserContext extends {}>(
  options: YogaServerOptions<ServerContext, UserContext>
) {
  const yoga = createYoga<ServerContext, UserContext>({
    ...options,
  });

  return async (
    event: APIGatewayProxyEventV2,
    lambdaContext: Context
  ): Promise<APIGatewayProxyResult> => {
    const parameters = new URLSearchParams(
      (event.queryStringParameters as Record<string, string>) || {}
    ).toString();

    const url = `${event.rawPath}?${parameters}`;

    const request: RequestInit = {
      method: event.requestContext.http.method,
      headers: event.headers as HeadersInit,
      body: event.body
        ? Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8")
        : undefined,
    };

    const serverContext: ServerContext = {
      event,
      context: lambdaContext,
    };

    const response = await yoga.fetch(url, request, serverContext);
    const responseHeaders = Object.fromEntries(response.headers.entries());

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: await response.text(),
      isBase64Encoded: false,
    };
  };
}
