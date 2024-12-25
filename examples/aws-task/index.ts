import { Resource } from "sst";
import { task } from "sst/aws/task";

export const handler = async () => {
  const ret = await task.run(Resource.MyTask);
  return {
    statusCode: 200,
    body: JSON.stringify(ret),
    headers: {
      "Content-Type": "application/json",
    },
  };

  //const ret = await task.describe(Resource.MyTask, t);

  //const ret = await task.stop(Resource.MyTask, t);
  //console.log(ret.task?.lastStatus);
};
