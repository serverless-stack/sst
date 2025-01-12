// This is a custom Lambda URL handler which imports the React Router server
// build and performs the React Router server rendering.

import { createRequestHandler } from "react-router";

function convertApigRequestToNode(event) {
  if (event.headers["x-forwarded-host"]) {
    event.headers.host = event.headers["x-forwarded-host"];
  }

  const search = event.rawQueryString.length ? `?${event.rawQueryString}` : "";
  const url = new URL(event.rawPath + search, `https://${event.headers.host}`);
  const isFormData = event.headers["content-type"]?.includes(
    "multipart/form-data",
  );

  // Build headers
  const headers = new Headers();
  for (let [header, value] of Object.entries(event.headers)) {
    if (value) {
      headers.append(header, value);
    }
  }

  return new Request(url.href, {
    method: event.requestContext.http.method,
    headers,
    body:
      event.body && event.isBase64Encoded
        ? isFormData
          ? Buffer.from(event.body, "base64")
          : Buffer.from(event.body, "base64").toString()
        : event.body,
  });
}

const createApigHandler = (build) => {
  const requestHandler = createRequestHandler(build, "production");

  return awslambda.streamifyResponse(async (event, responseStream, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    const request = convertApigRequestToNode(event);
    const response = await requestHandler(request);
    const httpResponseMetadata = {
      statusCode: response.status,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        "Transfer-Encoding": "chunked",
      },
      cookies: response.headers.getSetCookie(),
    };

    const writer = awslambda.HttpResponseStream.from(
      responseStream,
      httpResponseMetadata,
    );

    if (response.body) {
      await streamToNodeStream(response.body.getReader(), responseStream);
    } else {
      writer.write(" ");
    }
    writer.end();
  });
};

const streamToNodeStream = async (reader, writer) => {
  let readResult = await reader.read();
  while (!readResult.done) {
    writer.write(readResult.value);
    readResult = await reader.read();
  }
  writer.end();
};

export const handler = createApigHandler(reactRouterServerBuild);
