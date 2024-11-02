import { Handler, S3Event } from 'aws-lambda';

export const handler: Handler<S3Event> = async (event) => {
  console.log(event);
  return "ok";
};
