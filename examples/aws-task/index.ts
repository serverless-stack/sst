import { Resource } from "sst";
import { task } from "sst/aws/task";

export const handler = async () => {
  const ret = await task.run(Resource.MyTask);
  return {
    statusCode: 200,
    body: JSON.stringify(ret, null, 2),
  };
};
