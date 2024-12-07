import { ComponentResourceOptions, output, Output } from "@pulumi/pulumi";
import { Component, Transform, transform } from "../component";
import { Function, FunctionArgs, FunctionArn } from "./function";
import { Input } from "../input.js";
import { cloudwatch, lambda } from "@pulumi/aws";
import { functionBuilder, FunctionBuilder } from "./helpers/function-builder";

export interface CronArgs {
  /**
   * The function that'll be executed when the cron job runs.
   *
   * @example
   *
   * ```ts
   * {
   *   job: "src/cron.handler"
   * }
   * ```
   *
   * You can pass in the full function props.
   *
   * ```ts
   * {
   *   job: {
   *     handler: "src/cron.handler",
   *     timeout: "60 seconds"
   *   }
   * }
   * ```
   *
   * You can also pass in a function ARN.
   *
   * ```ts
   * {
   *   job: "arn:aws:lambda:us-east-1:000000000000:function:my-sst-app-jayair-MyFunction",
   * }
   * ```
   */
  job: Input<string | FunctionArgs | FunctionArn>;
  /**
   * The schedule for the cron job.
   *
   * :::note
   * The cron job continues to run even after you exit `sst dev`.
   * :::
   *
   * @example
   *
   * You can use a [rate expression](https://docs.aws.amazon.com/lambda/latest/dg/services-cloudwatchevents-expressions.html).
   *
   * ```ts
   * {
   *   schedule: "rate(5 minutes)"
   *   // schedule: "rate(1 minute)"
   *   // schedule: "rate(5 minutes)"
   *   // schedule: "rate(1 hour)"
   *   // schedule: "rate(5 hours)"
   *   // schedule: "rate(1 day)"
   *   // schedule: "rate(5 days)"
   * }
   * ```
   * Or a [cron expression](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-create-rule-schedule.html#eb-cron-expressions).
   *
   * ```ts
   * {
   *   schedule: "cron(15 10 * * ? *)", // 10:15 AM (UTC) every day
   * }
   * ```
   */
  schedule: Input<`rate(${string})` | `cron(${string})`>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying resources.
   */
  transform?: {
    /**
     * Transform the EventBridge Rule resource.
     */
    rule?: Transform<cloudwatch.EventRuleArgs>;
    /**
     * Transform the EventBridge Target resource.
     */
    target?: Transform<cloudwatch.EventTargetArgs>;
  };
}

/**
 * The `Cron` component lets you add cron jobs to your app.
 * It uses [Amazon Event Bus](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html).
 *
 * @example
 * #### Minimal example
 *
 * Pass in a `schedule` and a `job` function that'll be executed.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Cron("MyCronJob", {
 *   job: "src/cron.handler",
 *   schedule: "rate(1 minute)"
 * });
 * ```
 *
 * #### Customize the function
 *
 * ```js title="sst.config.ts"
 * new sst.aws.Cron("MyCronJob", {
 *   schedule: "rate(1 minute)",
 *   job: {
 *     handler: "src/cron.handler",
 *     timeout: "60 seconds"
 *   }
 * });
 * ```
 */
export class Cron extends Component {
  private fn: FunctionBuilder;
  private rule: cloudwatch.EventRule;
  private target: cloudwatch.EventTarget;

  constructor(name: string, args: CronArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);

    const parent = this;

    const fn = createFunction();
    const rule = createRule();
    const target = createTarget();
    createPermission();

    this.fn = fn;
    this.rule = rule;
    this.target = target;

    function createFunction() {
      return output(args.job).apply((job) =>
        functionBuilder(`${name}Handler`, job, {}, undefined, {
          parent,
        }),
      );
    }

    function createRule() {
      return new cloudwatch.EventRule(
        ...transform(
          args.transform?.rule,
          `${name}Rule`,
          {
            scheduleExpression: args.schedule,
          },
          { parent },
        ),
      );
    }

    function createTarget() {
      return new cloudwatch.EventTarget(
        ...transform(
          args.transform?.target,
          `${name}Target`,
          {
            arn: fn.arn,
            rule: rule.name,
          },
          { parent },
        ),
      );
    }

    function createPermission() {
      return new lambda.Permission(
        `${name}Permission`,
        {
          action: "lambda:InvokeFunction",
          function: fn.arn,
          principal: "events.amazonaws.com",
          sourceArn: rule.arn,
        },
        { parent },
      );
    }
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    const self = this;
    return {
      /**
       * The AWS Lambda Function that's invoked when the cron job runs.
       */
      get job() {
        return self.fn.apply((fn) => fn.getFunction());
      },
      /**
       * The EventBridge Rule resource.
       */
      rule: this.rule,
      /**
       * The EventBridge Target resource.
       */
      target: this.target,
    };
  }
}

const __pulumiType = "sst:aws:Cron";
// @ts-expect-error
Cron.__pulumiType = __pulumiType;
