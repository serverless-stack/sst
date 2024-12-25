import { AwsOptions, client } from "./client.js";

/**
 * The `task` client SDK is available through the following.
 *
 * @example
 * ```js title="src/app.ts"
 * import { task } from "sst/aws/task";
 * ```
 *
 * If you are not using Node.js, you can use the AWS SDK instead. For example, you can call
 * [`RunTask`](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html) to
 * run a task.
 */
export module task {
  function url(region?: string, options?: AwsOptions) {
    if (options?.region) region = options.region;
    return `https://ecs.${region}.amazonaws.com/`;
  }

  /**
   * The link data for the task.
   *
   * @example
   * For example, let's say you have a task.
   *
   * ```js title="sst.config.ts"
   * cluster.addTask("MyTask");
   * ```
   *
   * `Resource.MyTask` will have all the link data.
   *
   * ```js title="src/app.ts"
   * import { Resource } from "sst";
   *
   * console.log(Resource.MyTask);
   * ```
   */
  export interface Resource {
    /**
     * The ARN of the cluster.
     */
    cluster: string;
    /**
     * The ARN of the task definition.
     */
    taskDefinition: string;
    /**
     * The subnets to use for the task.
     */
    subnets: string[];
    /**
     * The security groups to use for the task.
     */
    securityGroups: string[];
    /**
     * Whether to assign a public IP address to the task.
     */
    assignPublicIp: boolean;
    /**
     * The names of the containers in the task.
     */
    containers: string[];
  }

  export interface Options {
    /**
     * Configure the options for the [aws4fetch](https://github.com/mhart/aws4fetch)
     * [`AWSClient`](https://github.com/mhart/aws4fetch?tab=readme-ov-file#new-awsclientoptions) used internally by the SDK.
     */
    aws?: AwsOptions;
  }

  interface Task {
    /**
     * The ARN of the task.
     */
    arn: string;
    /**
     * The status of the task.
     */
    status: string;
  }

  export interface DescribeResponse extends Task {
    /**
     * The raw response from the AWS ECS DescribeTasks API.
     * @see [@aws-sdk/client-ecs.DescribeTasksResponse](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-ecs/Interface/DescribeTasksResponse/)
     */
    response: any;
  }

  export interface RunResponse extends Task {
    /**
     * The raw response from the AWS ECS RunTask API.
     * @see [@aws-sdk/client-ecs.RunTaskResponse](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-ecs/Interface/RunTaskResponse/)
     */
    response: any;
  }

  export interface StopResponse extends Task {
    /**
     * The raw response from the AWS ECS StopTask API.
     * @see [@aws-sdk/client-ecs.StopTaskResponse](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-ecs/Interface/StopTaskResponse/)
     */
    response: any;
  }

  /**
   * Get the details of a given task.
   *
   * :::note
   * If a task had been stopped over an hour ago, it's not returned.
   * :::
   *
   * @example
   *
   * For example, let's say you had previously started a task.
   *
   * ```js title="src/app.ts"
   * const runRet = await task.run(Resource.MyTask);
   * const taskArn = runRet.tasks[0].taskArn;
   * ```
   *
   * You can use that to get the details of the task.
   *
   * ```js title="src/app.ts"
   * const describeRet = await task.describe(Resource.MyTask, taskArn);
   * console.log(describeRet.status);
   * ```
   *
   * If you are not using Node.js, you can use the AWS SDK and call
   * [`DescribeTasks`](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DescribeTasks.html).
   */
  export async function describe(
    resource: Resource,
    task: string,
    options?: Options
  ): Promise<DescribeResponse> {
    const c = await client();
    const u = url(c.region, options?.aws);
    const res = await c.fetch(u, {
      method: "POST",
      aws: options?.aws,
      headers: {
        "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.DescribeTasks",
        "Content-Type": "application/x-amz-json-1.1",
      },
      body: JSON.stringify({
        cluster: resource.cluster,
        tasks: [task],
      }),
    });
    if (!res.ok) throw new DescribeError(res);

    const data = (await res.json()) as {
      tasks?: {
        taskArn: string;
        lastStatus: string;
      }[];
    };
    if (!data.tasks?.length) throw new DescribeError(res);

    return {
      arn: data.tasks[0].taskArn,
      status: data.tasks[0].lastStatus,
      response: data,
    };
  }

  /**
   * Runs a task.
   *
   * @example
   *
   * For example, let's say you have defined a task.
   *
   * ```js title="sst.config.ts"
   * cluster.addTask("MyTask");
   * ```
   *
   * You can then run the task in your application with the SDK.
   *
   * ```js title="src/app.ts" {4}
   * import { Resource } from "sst";
   * import { task } from "sst/aws/task";
   *
   * const runRet = await task.run(Resource.MyTask);
   * const taskArn = runRet.tasks[0].taskArn;
   * ```
   *
   * This internally calls an AWS SDK API that returns an array of tasks. But in our case,
   * there's only one task.
   *
   * The `taskArn` is the ARN of the task. You can use it to call the `describe` or `stop`
   * functions.
   *
   * You can also pass in any environment variables to the task.
   *
   * ```js title="src/app.ts"
   * await task.run(Resource.MyTask, {
   *   MY_ENV_VAR: "my-value"
   * });
   * ```
   *
   * If you are not using Node.js, you can use the AWS SDK and call
   * [`RunTask`](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html).
   */
  export async function run(
    resource: Resource,
    environment?: Record<string, string>,
    options?: Options
  ): Promise<RunResponse> {
    const c = await client();
    const u = url(c.region, options?.aws);
    const res = await c.fetch(u, {
      method: "POST",
      aws: options?.aws,
      headers: {
        "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.RunTask",
        "Content-Type": "application/x-amz-json-1.1",
      },
      body: JSON.stringify({
        cluster: resource.cluster,
        launchType: "FARGATE",
        taskDefinition: resource.taskDefinition,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: resource.subnets,
            securityGroups: resource.securityGroups,
            assignPublicIp: resource.assignPublicIp ? "ENABLED" : "DISABLED",
          },
        },
        overrides: {
          containerOverrides: resource.containers.map((name) => ({
            name,
            environment: Object.entries(environment ?? {}).map(
              ([key, value]) => ({
                name: key,
                value,
              })
            ),
          })),
        },
      }),
    });
    if (!res.ok) throw new RunError(res);

    const data = (await res.json()) as {
      tasks?: {
        taskArn: string;
        lastStatus: string;
      }[];
    };
    if (!data.tasks?.length) throw new RunError(res);

    return {
      arn: data.tasks[0].taskArn,
      status: data.tasks[0].lastStatus,
      response: data,
    };
  }

  /**
   * Stops a task.
   *
   * @example
   *
   * For example, let's say you had previously started a task.
   *
   * ```js title="src/app.ts"
   * const runRet = await task.run(Resource.MyTask);
   * const taskArn = runRet.tasks[0].taskArn;
   * ```
   *
   * You can stop the task with the following.
   *
   * ```js title="src/app.ts"
   * const stopRet = await task.stop(Resource.MyTask, taskArn);
   * ```
   *
   * Stopping a task is asnychronous. When you call `stop`, AWS marks a task to be stopped,
   * but it may take a few minutes for the task to actually stop. 
   *
   * :::note
   * Stopping a task in asyncrhonous.
   * :::
   *
   * In most cases you probably don't need to check if it has been stopped. But if necessary,
   * you can use the `describe` function to get a task's status.
   *
   * If you are not using Node.js, you can use the AWS SDK and call
   * [`StopTask`](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_StopTask.html).
   */
  export async function stop(
    resource: Resource,
    task: string,
    options?: Options
  ): Promise<StopResponse> {
    const c = await client();
    const u = url(c.region, options?.aws);
    const res = await c.fetch(u, {
      method: "POST",
      aws: options?.aws,
      headers: {
        "X-Amz-Target": "AmazonEC2ContainerServiceV20141113.StopTask",
        "Content-Type": "application/x-amz-json-1.1",
      },
      body: JSON.stringify({
        cluster: resource.cluster,
        task,
      }),
    });
    if (!res.ok) throw new StopError(res);

    const data = (await res.json()) as {
      task: {
        taskArn: string;
        lastStatus: string;
      };
    };
    if (!data.task) throw new StopError(res);

    return {
      arn: data.task.taskArn,
      status: data.task.lastStatus,
      response: data,
    };
  }

  export class DescribeError extends Error {
    constructor(public readonly response: Response) {
      super("Failed to describe task");
      console.log(response);
    }
  }

  export class RunError extends Error {
    constructor(public readonly response: Response) {
      super("Failed to run task");
      console.log(response);
    }
  }
  export class StopError extends Error {
    constructor(public readonly response: Response) {
      super("Failed to stop task");
      console.log(response);
    }
  }
}
