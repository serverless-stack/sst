// This is a custom Lambda@Edge handler which imports the React Router server
// build and performs the React Router server rendering.

import { createRequestHandler, readableStreamToString } from "react-router";
import { URL } from "url";

/**
 * Common binary MIME types
 */
const binaryTypes = [
  "application/octet-stream",
  // Docs
  "application/epub+zip",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.amazon.ebook",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // Fonts
  "font/otf",
  "font/woff",
  "font/woff2",
  // Images
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/vnd.microsoft.icon",
  "image/webp",
  // Audio
  "audio/3gpp",
  "audio/aac",
  "audio/basic",
  "audio/mpeg",
  "audio/ogg",
  "audio/wavaudio/webm",
  "audio/x-aiff",
  "audio/x-midi",
  "audio/x-wav",
  // Video
  "video/3gpp",
  "video/mp2t",
  "video/mpeg",
  "video/ogg",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  // Archives
  "application/java-archive",
  "application/vnd.apple.installer+xml",
  "application/x-7z-compressed",
  "application/x-apple-diskimage",
  "application/x-bzip",
  "application/x-bzip2",
  "application/x-gzip",
  "application/x-java-archive",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/x-zip",
  "application/zip",
];

function isBinaryType(contentType) {
  if (!contentType) return false;
  return binaryTypes.some((t) => contentType.includes(t));
}

function convertCfRequestToNode(event) {
  const request = event.Records[0].cf.request;
  if (request.headers["x-forwarded-host"]) {
    request.headers.host = request.headers["x-forwarded-host"];
  }

  const search = request.querystring.length ? `?${request.querystring}` : "";
  const url = new URL(
    request.uri + search,
    `https://${request.headers["host"][0].value}`,
  );

  // Build headers
  const headers = new Headers();
  for (const [key, values] of Object.entries(request.headers)) {
    for (const { value } of values) {
      if (value) {
        headers.append(key, value);
      }
    }
  }

  return new Request(url.toString(), {
    method: request.method,
    headers,
    body: request.body?.data
      ? request.body.encoding === "base64"
        ? Buffer.from(request.body.data, "base64").toString()
        : request.body.data
      : undefined,
  });
}

async function convertNodeResponseToCf(nodeResponse) {
  const contentType = nodeResponse.headers.get("Content-Type");
  const isBase64Encoded = isBinaryType(contentType);

  // Build headers
  const headers = {};
  const rawHeaders = nodeResponse.headers.raw();
  for (const key in rawHeaders) {
    const value = rawHeaders[key];
    for (const v of value) {
      headers[key] = [...(headers[key] || []), { key, value: v }];
    }
  }

  // Build body
  let body;
  if (nodeResponse.body) {
    if (isBase64Encoded) {
      body = await readableStreamToString(nodeResponse.body, "base64");
    } else {
      body = await nodeResponse.text();
    }
  }

  return {
    status: String(nodeResponse.status),
    headers,
    bodyEncoding: isBase64Encoded ? "base64" : "text",
    body,
  };
}

function createCfHandler(build) {
  const requestHandler = createRequestHandler(build, process.env.NODE_ENV);

  return async (event) => {
    const request = convertCfRequestToNode(event);
    const response = await requestHandler(request);
    return convertNodeResponseToCf(response);
  };
}

export const handler = createCfHandler(remixServerBuild);
