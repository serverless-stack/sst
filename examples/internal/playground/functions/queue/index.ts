import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
const client = new SQSClient();

export const publisher = async () => {
  await client.send(
    new SendMessageCommand({
      QueueUrl: Resource.MyQueue.url,
      MessageBody: JSON.stringify({ foo: "bar" }),
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ status: "sent" }, null, 2),
  };
};

export const subscriber = async () => {
  console.log("queue subscriber: message received");
};
