import { Resource } from "/Users/frank/Sites/sst/sdk/js/src/resource";
import { task } from "/Users/frank/Sites/sst/sdk/js/src/aws/task";

export const handler = async () => {
  const ret = await task.run(Resource.MyTask);

  if (ret.tasks?.length) {
    return {
      taskArn: ret.tasks[0].taskArn,
    };
  }

  return ret;

  //const ret = await task.describe(Resource.MyTask, t);

  //const ret = await task.stop(Resource.MyTask, t);
  //console.log(ret.task?.lastStatus);
};
