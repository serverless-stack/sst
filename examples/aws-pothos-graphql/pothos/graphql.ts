import { schema } from "./schema";
import { awsLambdaRequestHandler } from "./server";

export const handler = awsLambdaRequestHandler({
  schema,
});
