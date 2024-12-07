import { Resource } from "sst";
import {
  SQSClient,
  SendMessageBatchCommand,
  PurgeQueueCommand,
} from "@aws-sdk/client-sqs";
const client = new SQSClient();

export const seeder = async () => {
  await client.send(
    new SendMessageBatchCommand({
      QueueUrl: Resource.MyQueue.url,
      Entries: [
        { Id: "1", MessageBody: JSON.stringify({ foo: "bar" }) },
        { Id: "2", MessageBody: JSON.stringify({ foo: "bar" }) },
        { Id: "3", MessageBody: JSON.stringify({ foo: "bar" }) },
        { Id: "4", MessageBody: JSON.stringify({ foo: "bar" }) },
        { Id: "5", MessageBody: JSON.stringify({ foo: "bar" }) },
      ],
    })
  );

  return { statusCode: 200, body: "seeded" };
};

export const purger = async () => {
  await client.send(
    new PurgeQueueCommand({
      QueueUrl: Resource.MyQueue.url,
    })
  );

  return { statusCode: 200, body: "purged" };
};
