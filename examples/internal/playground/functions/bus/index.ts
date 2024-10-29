import { Resource } from "sst";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient();

export const publisher = async () => {
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: Resource.MyBus.name,
          Source: "app.myevent",
          DetailType: "MyEvent",
          Detail: JSON.stringify({ foo: "bar" }),
        },
      ],
    })
  );
  return {
    statusCode: 200,
  };
};

export const subscriber = async () => {
  console.log("bus subscriber: message received");
};
