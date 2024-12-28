import type { LambdaFunctionURLHandler } from "aws-lambda";
import { bus } from "sst/aws/bus";
import { Resource } from "sst";
import { testEvent } from "./event";

// This function sends a message to the bus. This could be any other service which pugliches message to the bus.
export const handler: LambdaFunctionURLHandler = async (evt) => {
  if (!evt.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "missing body" }),
    };
  }

  try {
    const body = JSON.parse(evt.body);
    const message = body.message;
    if (typeof message !== "string") {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "message must be a string" }),
      };
    }
    bus.publish(Resource.bus.name, testEvent, { message });
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "error" }),
    };
  }

  return {
    statusCode: 200,
  };
};
