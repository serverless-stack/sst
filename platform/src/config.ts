/**
 * The `sst.config.ts` file is used to configure your SST app and its resources.
 *
 * ```ts
 * $config(input: Config): Config
 * ```
 *
 * You specify it using the `$config` function. This takes an object of type [`Config`](#config).
 *
 * ```ts title="sst.config.ts"
 * /// <reference path="./.sst/platform/config.d.ts" />
 *
 * export default $config({
 *   // Your app's config
 *   app(input) {
 *     return {
 *       name: "my-sst-app",
 *       home: "aws"
 *     };
 *   },
 *   // Your app's resources
 *   async run() {
 *     const bucket = new sst.aws.Bucket("MyBucket");
 *
 *     // Your app's outputs
 *     return {
 *       bucket: bucket.name
 *     };
 *   }
 * });
 * ```
 *
 * The `Config` object takes two functions:
 * 1. [`app`](#app-2) — Your config
 * 2. [`run`](#run) — Your resources
 *
 * The `app` function is evaluated right when your app loads. It's used to define the app config and its providers.
 *
 * :::note
 * You need TypeScript 5 to see the types in your config.
 * :::
 *
 * You can add Pulumi code in the `run` function not the `app` function. While the `run`
 * function is where you define your resources using SST or Pulumi's components.
 *
 * The run function also has access to a list of [Global](/docs/reference/global/) `$` variables and functions. These serve as the context for your app config.
 *
 * :::caution
 * Do not `import` the provider packages in your `sst.config.ts`.
 * :::
 *
 * Since SST manages importing your provider packages, it's recommended not to add any imports
 * in your `sst.config.ts`.
 *
 * ---
 *
 * #### .env
 *
 * Your `.env` and `.env.<stage>` files are loaded as environment variables in your config.
 * They need to be in the same directory as your `sst.config.ts`.
 *
 * ```bash title=".env"
 * MY_ENV_VAR=hello
 * ```
 *
 * And are available as `process.env` in both your `app` and `run` functions.
 *
 * ```ts title="sst.config.ts"
 * process.env.MY_ENV_VAR
 * ```
 *
 * The `.env` file takes precedence over `.env.<stage>`. So if you have a `.env` and a
 * `.env.dev` file, the values in the `.env` file will be used.
 *
 * :::note
 * You need to restart `sst dev` for changes in your `.env` files to take effect.
 * :::
 *
 * Make sure the stage name in your `.env.<stage>` matches the stage your app is running on.
 *
 * @packageDocumentation
 */

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export interface App {
  /**
   * The version of SST supported by the app. The CLI will fail any commands if the version does
   * not match.
   *
   * :::tip
   * Useful in CI where you don't want it to automatically deploy with a new version of SST.
   * :::
   *
   * @default The latest version of SST.
   *
   * @example
   *
   * Takes a specific version.
   *
   * ```ts
   * version: "3.2.49"
   * ```
   *
   * Also supports semver ranges.
   * ```ts
   * version: ">= 3.2.49"
   * ```
   */
  version?: string;

  /**
   * The name of the app. This is used to prefix the names of the resources in your app.
   *
   * :::caution
   * If you change the name of your app, it'll redeploy your app with new resources. The old resources will be orphaned.
   * :::
   *
   * This means that you don't want to change the name of your app without removing the old resources first.
   *
   * @example
   *
   * ```ts
   * {
   *   name: "my-sst-app"
   * }
   * ```
   */
  name: string;
  /**
   * Configure how your resources are handled on `sst remove`:
   *
   * - `remove`: Remove all your resources on remove.
   * - `retain`: Retains S3 buckets and DynamoDB tables, and remove all other resources.
   * - `retain-all`: Retains all your resources on remove.
   *
   * :::tip
   * If you change your removal policy, you'll need to deploy your app once for it to take effect.
   * :::
   *
   * @default `"retain"`
   * @example
   * Retain resources if it's the _production_ stage, otherwise remove all resources.
   * ```ts
   * {
   *   removal: input.stage === "production" ? "retain" : "remove"
   * }
   * ```
   */
  removal?: "remove" | "retain" | "retain-all";
  /**
   * The providers that are being used in this app. This allows you to use the resources from
   * these providers in your app.
   *
   * ```ts
   * {
   *   providers: {
   *     aws: "6.27.0",
   *     cloudflare: "5.37.1"
   *   }
   * }
   * ```
   *
   * Check out the full list in the [Directory](/docs/providers#directory).
   *
   * :::tip
   * You'll need to run `sst install` after you update the `providers` in your config.
   * :::
   *
   * If you don't set a `provider` it uses your `home` provider with the default config. So if you set `home` to `aws`, it's the same as doing:
   *
   * ```ts
   * {
   *   home: "aws",
   *   providers: {
   *     aws: "6.27.0"
   *   }
   * }
   * ```
   *
   * You can also configure the provider props. Here's the config for some common providers:
   * - [AWS](https://www.pulumi.com/registry/packages/aws/api-docs/provider/#inputs)
   * - [Cloudflare](https://www.pulumi.com/registry/packages/cloudflare/api-docs/provider/#inputs)
   *
   * @example
   *
   * For example, to change the region for AWS.
   *
   * ```ts
   * {
   *   providers: {
   *     aws: {
   *       region: "us-west-2"
   *     }
   *   }
   * }
   * ```
   *
   * @default The `home` provider.
   */
  providers?: Record<string, any>;

  /**
   * The provider SST will use to store the state for your app. The state keeps track of all your resources and secrets. The state is generated locally and backed up in your cloud provider.
   *
   *
   * Currently supports AWS, Cloudflare and local.
   *
   * :::tip
   * SST uses the `home` provider to store the state for your app. If you use the local provider it will be saved on your machine. You can see where by running `sst version`.
   * :::
   *
   * If you want to configure the aws or cloudflare home provider, you can:
   *
   * ```ts
   * {
   *   home: "aws",
   *   providers: {
   *     aws: {
   *       region: "us-west-2"
   *     }
   *   }
   * }
   * ```
   *
   */
  home: "aws" | "cloudflare" | "local";

  /**
   * Additional directories to watch for changes in `sst dev`.
   *
   * By default, SST watches the directory where the `sst.config.ts` file is located and all its subdirectories.
   * If you have additional directories that you want to watch for changes, you can add them here.
   * This is useful if SST is not on the root of your project.
   *
   */
  devAdditionalWatchPaths?: string[];
}

export interface AppInput {
  /**
   * The stage this app is running on. This is a string that can be passed in through the CLI.
   *
   * :::caution
   * Changing the stage will redeploy your app to a new stage with new resources. The old resources will still be around in the old stage.
   * :::
   *
   * If not passed in, it'll use the username of your local machine, or prompt you for it.
   */
  stage: string;
}

export interface Target {
  /**
   * The stage the app will be deployed to.
   */
  stage: string;
  /**
   * Configure the runner that will run the build.
   *
   * It uses this to create a _runner_ — a
   * [AWS CodeBuild](https://aws.amazon.com/codebuild/) project and an IAM Role,
   * in **your account**. By default it uses:
   *
   * ```ts
   * {
   *   engine: "codebuild",
   *   architecture: "x86_64",
   *   compute: "small",
   *   timeout: "1 hour"
   * }
   * ```
   *
   * :::note
   * Runners are shared across all apps in the same account and region.
   * :::
   *
   * Once a runner is created, it can be used to run multiple builds of the same
   * machine config concurrently.
   *
   * You are only charged for the number of build
   * minutes that you use. The pricing is based on the machine config used.
   * [Learn more about CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/).
   *
   * :::note
   * A runner can run multiple builds concurrently.
   * :::
   *
   * If a runner with the given config has been been previously created,
   * it'll be reused. The Console will also automatically remove runners that
   * have not been used for more than 7 days.
   */
  runner?: {
    /**
     * The service used to run the build. Currently, only AWS CodeBuild is supported.
     */
    engine: "codebuild";
    /**
     * The timeout for the build. It can be from `5 minutes` to `1 hour`.
     * @default `1 hour`
     */
    timeout?: `${number} ${"minute" | "minutes" | "hour" | "hours"}`;
    /**
     * The architecture of the build machine.
     * @default `x86_64`
     */
    architecture?: "x86_64" | "arm64";
    /**
     * The compute size of the build environment.
     *
     * For `x86_64`, the following compute sizes are supported:
     * - `small`: 3 GB, 2 vCPUs
     * - `medium`: 7 GB, 4 vCPUs
     * - `large`: 15 GB, 8 vCPUs
     * - `xlarge`: 70 GB, 36 vCPUs
     * - `2xlarge`: 145 GB, 72 vCPUs
     *
     * For `arm64` architecture, the following compute sizes are supported:
     * - `small`: 4 GB, 2 vCPUs
     * - `medium`: 8 GB, 4 vCPUs
     * - `large`: 16 GB, 8 vCPUs
     * - `xlarge`: 64 GB, 32 vCPUs
     * - `2xlarge`: 96 GB, 48 vCPUs
     *
     * To increase the memory used by your Node.js process in the build environment, you'll want
     * to set the `NODE_OPTIONS` environment variable to `--max-old-space-size=xyz`. Where `xyz`
     * is the memory size in MB. By default, this is set to 1.5 GB.
     *
     * Read more about the [CodeBuild build environments](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html).
     *
     * @default `medium`
     */
    compute?: "small" | "medium" | "large" | "xlarge" | "2xlarge";
  };
}

interface GitSender {
  /**
   * The ID of the user.
   */
  id: number;
  /**
   * The username of the user.
   */
  username: string;
}

interface GitCommit {
  /**
   * The ID of the commit.
   */
  id: string;
  /**
   * The commit message.
   */
  message: string;
}

interface GitRepo {
  /**
   * The ID of the repo. This is usually a number.
   */
  id: number;
  /**
   * The name of the owner or org the repo to belongs to.
   */
  owner: string;
  /**
   * The name of the repo.
   */
  repo: string;
}

/**
 * A git event for when a branch is updated or deleted. For example:
 * ```js
 * {
 *   type: "branch",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   branch: "main",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface BranchEvent {
  /**
   * The git event type, for the `BranchEvent` it's `branch`.
   */
  type: "branch";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you git push to a branch
   * - `removed` is when a branch is removed
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The name of the branch the event is coming from.
   */
  branch: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

/**
 * A git event for when a tag is created or deleted. For example:
 * ```js
 * {
 *   type: "tag",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   tag: "v1.5.2",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface TagEvent {
  /**
   * The git event type, for the `TagEvent` it's `tag`.
   */
  type: "tag";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you create a tag
   * - `removed` is when a tag is removed
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The name of the tag. For example, `v1.5.2`.
   */
  tag: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

/**
 * A git event for when a pull request is updated or deleted. For example:
 *
 * ```js
 * {
 *   type: "pull_request",
 *   action: "pushed",
 *   repo: {
 *     id: 1296269,
 *     owner: "octocat",
 *     repo: "Hello-World"
 *   },
 *   number: 1347,
 *   base: "main",
 *   head: "feature",
 *   commit: {
 *     id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
 *     message: "Update the README with new information"
 *   },
 *   sender: {
 *     id: 1,
 *     username: "octocat"
 *   }
 * }
 * ```
 */
export interface PullRequestEvent {
  /**
   * The git event type, for the `PullRequestEvent` it's `pull_request`.
   */
  type: "pull_request";
  /**
   * The type of the git action.
   *
   * - `pushed` is when you git push to the base branch of the PR
   * - `removed` is when the PR is closed or merged
   */
  action: "pushed" | "removed";
  /**
   * The Git repository the event is coming from. This might look like:
   *
   * ```js
   * {
   *   id: 1296269,
   *   owner: "octocat",
   *   repo: "Hello-World"
   * }
   * ```
   */
  repo: Prettify<GitRepo>;
  /**
   * The pull request number.
   */
  number: number;
  /**
   * The base branch of the PR. This is the branch the code is being merged into.
   */
  base: string;
  /**
   * The head branch of the PR. This is the branch the code is coming from.
   */
  head: string;
  /**
   * Info about the commit in the event. This might look like:
   *
   * ```js
   * {
   *   id: "b7e7c4c559e0e5b4bc6f8d98e0e5e5e5e5e5e5e5",
   *   message: "Update the README with new information"
   * }
   * ```
   */
  commit: Prettify<GitCommit>;
  /**
   * The user that generated the event. For example:
   *
   * ```js
   * {
   *   id: 1,
   *   username: "octocat"
   * }
   * ```
   */
  sender: Prettify<GitSender>;
}

export interface Config {
  /**
   * The config for your app. It needs to return an object of type [`App`](#app-1). The `app`
   * function is evaluated when your app loads.
   *
   * :::caution
   * You cannot define any components or resources in the `app` function.
   * :::
   *
   * Here's an example of a simple `app` function.
   *
   * @example
   *
   * ```ts title="sst.config.ts"
   * app(input) {
   *   return {
   *     name: "my-sst-app",
   *     home: "aws",
   *     providers: {
   *       aws: true,
   *       cloudflare: {
   *         accountId: "6fef9ed9089bb15de3e4198618385de2"
   *       }
   *     },
   *     removal: input.stage === "production" ? "retain" : "remove"
   *   };
   * },
   * ```
   */
  app(input: AppInput): App;
  /**
   * Configure how your app works with the SST Console. [Learn more about Autodeploy](/docs/console#autodeploy).
   */
  console?: {
    /**
     * Auto-deploys your app when you _git push_ to your repo. Uses
     * [AWS CodeBuild](https://aws.amazon.com/codebuild/) in your account to run the build.
     *
     * You are only charged for the number of build
     * minutes that you use. The pricing is based on the machine config used.
     * [Learn more about CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/).
     *
     * By default, this auto-deploys when you _git push_ to a:
     *
     * - **branch**: The stage name is a sanitized version of the branch name. When a branch
     *   is removed, the stage is **not removed**.
     * - **pull request**: The stage name is `pr-<number>`. When a pull request is closed,
     *   the stage **is removed**.
     *
     * :::note
     * You need to configure an environment in the Console to be able to auto-deploy to it.
     * :::
     *
     * You can pass in your own `target` function to customize this behaviour and the machine
     * that'll be used to run the build.
     *
     * ```ts title="sst.config.ts"
     * console: {
     *   autodeploy: {
     *     target(event) {
     *       if (
     *         event.type === "branch" &&
     *         event.branch === "main" &&
     *         event.action === "pushed"
     *        ) {
     *         return {
     *           stage: "production",
     *           runner: { engine: "codebuild", compute: "large" }
     *         };
     *       }
     *     }
     *   }
     * }
     * ```
     *
     * @default Auto-deploys branches and PRs.
     */
    autodeploy: {
      /**
       * Defines the stage the app will be auto-deployed to.
       *
       * When a git event is received, Autodeploy will run the `target` function with the
       * git event. This function should return the stage the app will be deployed to.
       * Or `undefined` if the deploy should be skipped.
       *
       * :::note
       * Git push events for branches, pull requests, and tags are currently supported.
       * :::
       *
       * By default, this is what the `target` function looks like:
       *
       * ```ts title="sst.config.ts"
       * target(event) {
       *   if (event.type === "branch" && event.action === "pushed") {
       *     return {
       *       stage: event.branch
       *         .replace(/[^a-zA-Z0-9-]/g, "-")
       *         .replace(/-+/g, "-")
       *         .replace(/^-/g, "")
       *         .replace(/-$/g, "")
       *     };
       *   }
       *
       *   if (event.type === "pull_request") {
       *     return { stage: `pr-${event.number}` };
       *   }
       * }
       * ```
       *
       * Here we are sanitizing the branch name to generate the stage name. We are also
       * only deploying when _pushed_ to a branch, and **not** when a branch is removed.
       *
       * :::tip
       * Use the git event to configure how your app will be auto-deployed.
       * :::
       *
       * You can change the default behavior by passing in your own `target` function.
       * For example, to auto-deploy to the `production` stage when you git push to the
       * `main` branch.
       *
       * ```ts title="sst.config.ts"
       * target(event) {
       *   if (event.type === "branch" && event.branch === "main" && event.action === "pushed") {
       *     return { stage: "production" };
       *   }
       * }
       * ```
       *
       * If you don't want to auto-deploy for a given event, you can return `undefined`. For
       * example, to skip any deploys to the `staging` stage.
       *
       * ```ts title="sst.config.ts" {2}
       * target(event) {
       *   if (event.type === "branch" && event.branch === "staging") return;
       *   if (event.type === "branch" && event.branch === "main" && event.action === "pushed") {
       *     return { stage: "production" };
       *   }
       * }
       * ```
       *
       * The stage that is returned is then compared to the environments set in the
       * [app settings in the Console](/docs/console/#setup). If the stage matches a deployment
       * target, the stage will be deployed to that environment. If no matching environment is
       * found, the deploy will be skipped.
       *
       * :::note
       * If a target is not returned, the app will not be deployed.
       * :::
       *
       * In addition to the `stage` you can also configure the `runner` that will run the build.
       * For example, to use a larger machine for the `production` stage.
       *
       * ```ts title="sst.config.ts"
       * target(event) {
       *   if (event.type === "branch" && event.branch === "main" && event.action === "pushed") {
       *     return {
       *       stage: "production"
       *       runner: {
       *         engine: "codebuild",
       *         compute: "large"
       *       };
       *     };
       *   }
       * }
       * ```
       */
      target(
        input: BranchEvent | PullRequestEvent | TagEvent,
      ): Target | undefined;
    };
  };
  /**
   * An async function that lets you define the resources in your app.
   *
   * :::note
   * You can use SST and Pulumi components only in the `run` function.
   * :::
   *
   * You can optionally return an object that'll be displayed as the output in the CLI.
   *
   * @example
   *
   * For example, here we return the name of the bucket we created.
   *
   * ```ts title="sst.config.ts"
   * async run() {
   *   const bucket = new sst.aws.Bucket("MyBucket");
   *
   *   return {
   *     bucket: bucket.name
   *   };
   * }
   * ```
   *
   * This will display the following in the CLI on `sst deploy` and `sst dev`.
   *
   * ```bash frame=\"none\"
   * bucket: bucket-jOaikGu4rla
   * ```
   *
   * These outputs are also written to a `.sst/output.json` file after every successful deploy.
   * It contains the above outputs in JSON.
   *
   * ```json title=".sst/output.json"
   * {"bucket": "bucket-jOaikGu4rla"}
   * ```
   */
  run(): Promise<Record<string, any> | void>;
}

/** @internal */
export function $config(input: Config): Config {
  return input;
}
