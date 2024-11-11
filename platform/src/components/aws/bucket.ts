import {
  ComponentResourceOptions,
  output,
  interpolate,
  all,
  Output,
} from "@pulumi/pulumi";
import { RandomId } from "@pulumi/random";
import {
  physicalName,
  hashNumberToPrettyString,
  hashStringToPrettyString,
  logicalName,
} from "../naming";
import { Component, Prettify, Transform, transform } from "../component";
import { Link } from "../link";
import type { Input } from "../input";
import { FunctionArgs, FunctionArn } from "./function";
import { Duration, toSeconds } from "../duration";
import { VisibleError } from "../error";
import { parseBucketArn } from "./helpers/arn";
import { BucketLambdaSubscriber } from "./bucket-lambda-subscriber";
import { iam, s3 } from "@pulumi/aws";
import { permission } from "./permission";
import { BucketQueueSubscriber } from "./bucket-queue-subscriber";
import { BucketTopicSubscriber } from "./bucket-topic-subscriber";

interface BucketCorsArgs {
  /**
   * The HTTP headers that origins can include in requests to the bucket.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowHeaders: ["date", "keep-alive", "x-custom-header"]
   *   }
   * }
   * ```
   */
  allowHeaders?: Input<Input<string>[]>;
  /**
   * The origins that can access the bucket.
   * @default `["*"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowOrigins: ["https://www.example.com", "http://localhost:60905"]
   *   }
   * }
   * ```
   * Or the wildcard for all origins.
   * ```js
   * {
   *   cors: {
   *     allowOrigins: ["*"]
   *   }
   * }
   * ```
   */
  allowOrigins?: Input<Input<string>[]>;
  /**
   * The HTTP methods that are allowed when calling the bucket.
   * @default `["DELETE" | "GET" | "HEAD" | "POST" | "PUT"]`
   * @example
   * ```js
   * {
   *   cors: {
   *     allowMethods: ["GET", "POST", "DELETE"]
   *   }
   * }
   * ```
   */
  allowMethods?: Input<Input<"DELETE" | "GET" | "HEAD" | "POST" | "PUT">[]>;
  /**
   * The HTTP headers you want to expose to an origin that calls the bucket.
   * @default `[]`
   * @example
   * ```js
   * {
   *   cors: {
   *     exposeHeaders: ["date", "keep-alive", "x-custom-header"]
   *   }
   * }
   * ```
   */
  exposeHeaders?: Input<Input<string>[]>;
  /**
   * The maximum amount of time the browser can cache results of a preflight request. By
   * default the browser doesn't cache the results. The maximum value is `86400 seconds` or `1 day`.
   * @default `"0 seconds"`
   * @example
   * ```js
   * {
   *   cors: {
   *     maxAge: "1 day"
   *   }
   * }
   * ```
   */
  maxAge?: Input<Duration>;
}

export interface BucketArgs {
  /**
   * Enable public read access for all the files in the bucket.
   *
   * :::tip
   * You don't need to enable this if you're using CloudFront to serve files from the bucket.
   * :::
   *
   * Should only be turned on if you want to host public files directly from the bucket.
   * @deprecated Use `access` instead.
   * @default `false`
   * @example
   * ```js
   * {
   *   public: true
   * }
   * ```
   */
  public?: Input<boolean>;
  /**
   * Enable public read access for all the files in the bucket. By default, no access is
   * granted.
   *
   * :::tip
   * If you are using the `Router` to serve files from this bucket, you need to allow
   * `cloudfront` access the bucket.
   * :::
   *
   * This adds a statement to the bucket policy that either allows `public` access or just
   * `cloudfront` access.
   *
   * @example
   * ```js
   * {
   *   access: "public"
   * }
   * ```
   */
  access?: Input<"public" | "cloudfront">;
  /**
   * The CORS configuration for the bucket. Defaults to `true`, which is the same as:
   *
   * ```js
   * {
   *   cors: {
   *     allowHeaders: ["*"],
   *     allowOrigins: ["*"],
   *     allowMethods: ["DELETE", "GET", "HEAD", "POST", "PUT"],
   *     exposeHeaders: [],
   *     maxAge: "0 seconds"
   *   }
   * }
   * ```
   *
   * @default `true`
   */
  cors?: Input<false | Prettify<BucketCorsArgs>>;
  /**
   * Enable versioning for the bucket.
   *
   * Bucket versioning enables you to store multiple versions of an object, protecting
   * against accidental deletion or overwriting.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   versioning: true
   * }
   * ```
   */
  versioning?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the S3 Bucket resource.
     */
    bucket?: Transform<s3.BucketV2Args>;
    /**
     * Transform the S3 Bucket CORS configuration resource.
     */
    cors?: Transform<s3.BucketCorsConfigurationV2Args>;
    /**
     * Transform the S3 Bucket Policy resource.
     */
    policy?: Transform<s3.BucketPolicyArgs>;
    /**
     * Transform the S3 Bucket versioning resource.
     */
    versioning?: Transform<s3.BucketVersioningV2Args>;
    /**
     * Transform the public access block resource that's attached to the Bucket.
     *
     * Returns `false` if the public access block resource should not be created.
     */
    publicAccessBlock?: Transform<s3.BucketPublicAccessBlockArgs> | false;
  };
}

export interface BucketSubscriberArgs {
  /**
   * A list of S3 event types that'll trigger the notification.
   * @default All S3 events
   * @example
   * ```js
   * {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * }
   * ```
   */
  events?: Input<
    Input<
      | "s3:ObjectCreated:*"
      | "s3:ObjectCreated:Put"
      | "s3:ObjectCreated:Post"
      | "s3:ObjectCreated:Copy"
      | "s3:ObjectCreated:CompleteMultipartUpload"
      | "s3:ObjectRemoved:*"
      | "s3:ObjectRemoved:Delete"
      | "s3:ObjectRemoved:DeleteMarkerCreated"
      | "s3:ObjectRestore:*"
      | "s3:ObjectRestore:Post"
      | "s3:ObjectRestore:Completed"
      | "s3:ObjectRestore:Delete"
      | "s3:ReducedRedundancyLostObject"
      | "s3:Replication:*"
      | "s3:Replication:OperationFailedReplication"
      | "s3:Replication:OperationMissedThreshold"
      | "s3:Replication:OperationReplicatedAfterThreshold"
      | "s3:Replication:OperationNotTracked"
      | "s3:LifecycleExpiration:*"
      | "s3:LifecycleExpiration:Delete"
      | "s3:LifecycleExpiration:DeleteMarkerCreated"
      | "s3:LifecycleTransition"
      | "s3:IntelligentTiering"
      | "s3:ObjectTagging:*"
      | "s3:ObjectTagging:Put"
      | "s3:ObjectTagging:Delete"
      | "s3:ObjectAcl:Put"
    >[]
  >;
  /**
   * An S3 object key prefix that will trigger the notification.
   * @example
   * To filter for all the objects in the `images/` folder.
   * ```js
   * {
   *   filterPrefix: "images/"
   * }
   * ```
   */
  filterPrefix?: Input<string>;
  /**
   * An S3 object key suffix that will trigger the notification.
   * @example
   * To filter for all the objects with the `.jpg` suffix.
   * ```js
   * {
   *  filterSuffix: ".jpg"
   * }
   * ```
   */
  filterSuffix?: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this notification creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the S3 Bucket Notification resource.
     */
    notification?: Transform<s3.BucketNotificationArgs>;
  };
}

interface BucketRef {
  ref: boolean;
  bucket: s3.BucketV2;
}

/**
 * The `Bucket` component lets you add an [AWS S3 Bucket](https://aws.amazon.com/s3/) to
 * your app.
 *
 * @example
 *
 * #### Minimal example
 *
 * ```ts title="sst.config.ts"
 * const bucket = new sst.aws.Bucket("MyBucket");
 * ```
 *
 * #### Public read access
 *
 * Enable `public` read access for all the files in the bucket. Useful for hosting public files.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Bucket("MyBucket", {
 *   access: "public"
 * });
 * ```
 *
 * #### Add a subscriber
 *
 * ```ts title="sst.config.ts"
 * bucket.subscribe("src/subscriber.handler");
 * ```
 *
 * #### Link the bucket to a resource
 *
 * You can link the bucket to other resources, like a function or your Next.js app.
 *
 * ```ts title="sst.config.ts"
 * new sst.aws.Nextjs("MyWeb", {
 *   link: [bucket]
 * });
 * ```
 *
 * Once linked, you can generate a pre-signed URL to upload files in your app.
 *
 * ```ts title="app/page.tsx" {1,7}
 * import { Resource } from "sst";
 * import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
 * import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
 *
 * const command = new PutObjectCommand({
 *    Key: "file.txt",
 *    Bucket: Resource.MyBucket.name
 *  });
 *  await getSignedUrl(new S3Client({}), command);
 * ```
 */
export class Bucket extends Component implements Link.Linkable {
  private constructorName: string;
  private constructorOpts: ComponentResourceOptions;
  private isSubscribed: boolean = false;
  private bucket: Output<s3.BucketV2>;

  constructor(
    name: string,
    args: BucketArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    super(__pulumiType, name, args, opts);
    this.constructorName = name;
    this.constructorOpts = opts;

    if (args && "ref" in args) {
      const ref = args as BucketRef;
      this.bucket = output(ref.bucket);
      return;
    }

    const parent = this;
    const access = normalizeAccess();

    const bucket = createBucket();
    createVersioning();
    const publicAccessBlock = createPublicAccess();
    const policy = createBucketPolicy();
    createCorsRule();

    // Ensure the policy is created when the bucket is used in another component
    // (ie. bucket.name). Also, a bucket can only have one policy. We want to ensure
    // the policy created here is created first. And SST will throw an error if
    // another policy is created after this one.
    this.bucket = policy.apply(() => bucket);

    function normalizeAccess() {
      return all([args.public, args.access]).apply(([pub, access]) =>
        pub === true ? "public" : access,
      );
    }

    function createBucket() {
      const transformed = transform(
        args.transform?.bucket,
        `${name}Bucket`,
        {
          forceDestroy: true,
        },
        { parent },
      );

      if (!transformed[1].bucket) {
        const randomId = new RandomId(
          `${name}Id`,
          { byteLength: 6 },
          { parent },
        );
        transformed[1].bucket = randomId.dec.apply((dec) =>
          physicalName(
            63,
            name,
            `-${hashNumberToPrettyString(parseInt(dec), 8)}`,
          ).toLowerCase(),
        );
      }

      return new s3.BucketV2(...transformed);
    }

    function createVersioning() {
      return output(args.versioning).apply((versioning) => {
        if (!versioning) return;

        return new s3.BucketVersioningV2(
          ...transform(
            args.transform?.versioning,
            `${name}Versioning`,
            {
              bucket: bucket.bucket,
              versioningConfiguration: {
                status: "Enabled",
              },
            },
            { parent },
          ),
        );
      });
    }

    function createPublicAccess() {
      if (args.transform?.publicAccessBlock === false) return;

      return new s3.BucketPublicAccessBlock(
        ...transform(
          args.transform?.publicAccessBlock,
          `${name}PublicAccessBlock`,
          {
            bucket: bucket.bucket,
            blockPublicAcls: true,
            blockPublicPolicy: access.apply((v) => v !== "public"),
            ignorePublicAcls: true,
            restrictPublicBuckets: access.apply((v) => v !== "public"),
          },
          { parent },
        ),
      );
    }

    function createBucketPolicy() {
      return access.apply((access) => {
        const statements = [];
        if (access) {
          statements.push({
            principals: [
              access === "public"
                ? { type: "*", identifiers: ["*"] }
                : {
                    type: "Service",
                    identifiers: ["cloudfront.amazonaws.com"],
                  },
            ],
            actions: ["s3:GetObject"],
            resources: [interpolate`${bucket.arn}/*`],
          });
        }
        statements.push({
          effect: "Deny",
          principals: [{ type: "*", identifiers: ["*"] }],
          actions: ["s3:*"],
          resources: [bucket.arn, interpolate`${bucket.arn}/*`],
          conditions: [
            {
              test: "Bool",
              variable: "aws:SecureTransport",
              values: ["false"],
            },
          ],
        });

        return new s3.BucketPolicy(
          ...transform(
            args.transform?.policy,
            `${name}Policy`,
            {
              bucket: bucket.bucket,
              policy: iam.getPolicyDocumentOutput({ statements }).json,
            },
            {
              parent,
              dependsOn: publicAccessBlock,
            },
          ),
        );
      });
    }

    function createCorsRule() {
      return output(args.cors).apply((cors) => {
        if (cors === false) return;

        return new s3.BucketCorsConfigurationV2(
          ...transform(
            args.transform?.cors,
            `${name}Cors`,
            {
              bucket: bucket.bucket,
              corsRules: [
                {
                  allowedHeaders: cors?.allowHeaders ?? ["*"],
                  allowedMethods: cors?.allowMethods ?? [
                    "DELETE",
                    "GET",
                    "HEAD",
                    "POST",
                    "PUT",
                  ],
                  allowedOrigins: cors?.allowOrigins ?? ["*"],
                  exposeHeaders: cors?.exposeHeaders,
                  maxAgeSeconds: toSeconds(cors?.maxAge ?? "0 seconds"),
                },
              ],
            },
            { parent },
          ),
        );
      });
    }
  }

  /**
   * The generated name of the S3 Bucket.
   */
  public get name() {
    return this.bucket.bucket;
  }

  /**
   * The domain name of the bucket. Has the format `${bucketName}.s3.amazonaws.com`.
   */
  public get domain() {
    return this.bucket.bucketDomainName;
  }

  /**
   * The ARN of the S3 Bucket.
   */
  public get arn() {
    return this.bucket.arn;
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The Amazon S3 bucket.
       */
      bucket: this.bucket,
    };
  }

  /**
   * Reference an existing bucket with the given bucket name. This is useful when you
   * create a bucket in one stage and want to share it in another stage. It avoids having to
   * create a new bucket in the other stage.
   *
   * :::tip
   * You can use the `static get` method to share buckets across stages.
   * :::
   *
   * @param name The name of the component.
   * @param bucketName The name of the existing S3 Bucket.
   * @param opts? Resource options.
   *
   * @example
   * Imagine you create a bucket in the `dev` stage. And in your personal stage `frank`,
   * instead of creating a new bucket, you want to share the bucket from `dev`.
   *
   * ```ts title="sst.config.ts"
   * const bucket = $app.stage === "frank"
   *   ? sst.aws.Bucket.get("MyBucket", "app-dev-mybucket-12345678")
   *   : new sst.aws.Bucket("MyBucket");
   * ```
   *
   * Here `app-dev-mybucket-12345678` is the auto-generated bucket name for the bucket created
   * in the `dev` stage. You can find this by outputting the bucket name in the `dev` stage.
   *
   * ```ts title="sst.config.ts"
   * return {
   *   bucket: bucket.name
   * };
   * ```
   */
  public static get(
    name: string,
    bucketName: string,
    opts?: ComponentResourceOptions,
  ) {
    return new Bucket(name, {
      ref: true,
      bucket: s3.BucketV2.get(`${name}Bucket`, bucketName, undefined, opts),
    } as BucketArgs);
  }

  /**
   * Subscribe to events from this bucket.
   *
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe("src/subscriber.handler");
   * ```
   *
   * Subscribe to specific S3 events. The `link` ensures the subscriber can access the bucket.
   *
   * ```js title="sst.config.ts" "link: [bucket]"
   * bucket.subscribe({
   *   handler: "src/subscriber.handler",
   *   link: [bucket]
   * }, {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * bucket.subscribe("src/subscriber.handler", {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe({
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds",
   * });
   * ```
   *
   * Or pass in the ARN of an existing Lambda function.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe("arn:aws:lambda:us-east-1:123456789012:function:my-function");
   * ```
   */
  public subscribe(
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: BucketSubscriberArgs,
  ) {
    this.ensureNotSubscribed();
    return Bucket._subscribeFunction(
      this.constructorName,
      this.bucket.bucket,
      this.bucket.arn,
      subscriber,
      args,
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Subscribe to events of an S3 bucket that was not created in your app.
   *
   * @param bucketArn The ARN of the S3 bucket to subscribe to.
   * @param subscriber The function that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing S3 bucket with the following ARN.
   *
   * ```js title="sst.config.ts"
   * const bucketArn = "arn:aws:s3:::my-bucket";
   * ```
   *
   * You can subscribe to it by passing in the ARN.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribe(bucketArn, "src/subscriber.handler");
   * ```
   *
   * Subscribe to specific S3 events.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribe(bucketArn, "src/subscriber.handler", {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * sst.aws.Bucket.subscribe(bucketArn, "src/subscriber.handler", {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Customize the subscriber function.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribe(bucketArn, {
   *   handler: "src/subscriber.handler",
   *   timeout: "60 seconds",
   * });
   * ```
   */
  public static subscribe(
    bucketArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args?: BucketSubscriberArgs,
  ) {
    return output(bucketArn).apply((bucketArn) => {
      const bucketName = parseBucketArn(bucketArn).bucketName;
      return this._subscribeFunction(
        bucketName,
        bucketName,
        bucketArn,
        subscriber,
        args,
      );
    });
  }

  private static _subscribeFunction(
    name: string,
    bucketName: Input<string>,
    bucketArn: Input<string>,
    subscriber: Input<string | FunctionArgs | FunctionArn>,
    args: BucketSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return all([bucketArn, subscriber, args]).apply(
      ([bucketArn, subscriber, args]) => {
        const subscriberId = this.buildSubscriberId(
          bucketArn,
          typeof subscriber === "string" ? subscriber : subscriber.handler,
        );

        return new BucketLambdaSubscriber(
          `${name}Subscriber${subscriberId}`,
          {
            bucket: { name: bucketName, arn: bucketArn },
            subscriber,
            subscriberId,
            ...args,
          },
          opts,
        );
      },
    );
  }

  /**
   * Subscribe to events from this bucket with an SQS Queue.
   *
   * @param queueArn The ARN of the queue that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have a queue.
   *
   * ```js title="sst.config.ts"
   * const queue = sst.aws.Queue("MyQueue");
   * ```
   *
   * You can subscribe to this bucket with it.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe(queue.arn);
   * ```
   *
   * Subscribe to specific S3 events.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe(queue.arn, {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * bucket.subscribe(queue.arn, {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   */
  public subscribeQueue(
    queueArn: Input<string>,
    args: BucketSubscriberArgs = {},
  ) {
    this.ensureNotSubscribed();
    return Bucket._subscribeQueue(
      this.constructorName,
      this.bucket.bucket,
      this.arn,
      queueArn,
      args,
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Subscribe to events of an S3 bucket that was not created in your app with an SQS Queue.
   *
   * @param bucketArn The ARN of the S3 bucket to subscribe to.
   * @param queueArn The ARN of the queue that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing S3 bucket and SQS queue with the following ARNs.
   *
   * ```js title="sst.config.ts"
   * const bucketArn = "arn:aws:s3:::my-bucket";
   * const queueArn = "arn:aws:sqs:us-east-1:123456789012:MyQueue";
   * ```
   *
   * You can subscribe to the bucket with the queue.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribeQueue(bucketArn, queueArn);
   * ```
   *
   * Subscribe to specific S3 events.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribeQueue(bucketArn, queueArn, {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * sst.aws.Bucket.subscribeQueue(bucketArn, queueArn, {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   */
  public static subscribeQueue(
    bucketArn: Input<string>,
    queueArn: Input<string>,
    args?: BucketSubscriberArgs,
  ) {
    return output(bucketArn).apply((bucketArn) => {
      const bucketName = parseBucketArn(bucketArn).bucketName;
      return this._subscribeQueue(
        bucketName,
        bucketName,
        bucketArn,
        queueArn,
        args,
      );
    });
  }

  private static _subscribeQueue(
    name: string,
    bucketName: Input<string>,
    bucketArn: Input<string>,
    queueArn: Input<string>,
    args: BucketSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return all([bucketArn, queueArn, args]).apply(
      ([bucketArn, queueArn, args]) => {
        const subscriberId = this.buildSubscriberId(bucketArn, queueArn);

        return new BucketQueueSubscriber(
          `${name}Subscriber${subscriberId}`,
          {
            bucket: { name: bucketName, arn: bucketArn },
            queue: queueArn,
            subscriberId,
            ...args,
          },
          opts,
        );
      },
    );
  }

  /**
   * Subscribe to events from this bucket with an SNS Topic.
   *
   * @param topicArn The ARN of the topic that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have a topic.
   *
   * ```js title="sst.config.ts"
   * const topic = sst.aws.SnsTopic("MyTopic");
   * ```
   *
   * You can subscribe to this bucket with it.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe(topic.arn);
   * ```
   *
   * Subscribe to specific S3 events.
   *
   * ```js title="sst.config.ts"
   * bucket.subscribe(topic.arn, {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * bucket.subscribe(topic.arn, {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   */
  public subscribeTopic(
    topicArn: Input<string>,
    args: BucketSubscriberArgs = {},
  ) {
    this.ensureNotSubscribed();
    return Bucket._subscribeTopic(
      this.constructorName,
      this.bucket.bucket,
      this.arn,
      topicArn,
      args,
      { provider: this.constructorOpts.provider },
    );
  }

  /**
   * Subscribe to events of an S3 bucket that was not created in your app with an SNS Topic.
   *
   * @param bucketArn The ARN of the S3 bucket to subscribe to.
   * @param topicArn The ARN of the topic that'll be notified.
   * @param args Configure the subscription.
   *
   * @example
   *
   * For example, let's say you have an existing S3 bucket and SNS topic with the following ARNs.
   *
   * ```js title="sst.config.ts"
   * const bucketArn = "arn:aws:s3:::my-bucket";
   * const topicArn = "arn:aws:sns:us-east-1:123456789012:MyTopic";
   * ```
   *
   * You can subscribe to the bucket with the topic.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribe(bucketArn, topicArn);
   * ```
   *
   * Subscribe to specific S3 events.
   *
   * ```js title="sst.config.ts"
   * sst.aws.Bucket.subscribe(bucketArn, topicArn, {
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   *
   * Subscribe to specific S3 events from a specific folder.
   *
   * ```js title="sst.config.ts" {2}
   * sst.aws.Bucket.subscribe(bucketArn, topicArn, {
   *   filterPrefix: "images/",
   *   events: ["s3:ObjectCreated:*", "s3:ObjectRemoved:*"]
   * });
   * ```
   */
  public static subscribeTopic(
    bucketArn: Input<string>,
    topicArn: Input<string>,
    args?: BucketSubscriberArgs,
  ) {
    return output(bucketArn).apply((bucketArn) => {
      const bucketName = parseBucketArn(bucketArn).bucketName;
      return this._subscribeTopic(
        bucketName,
        bucketName,
        bucketArn,
        topicArn,
        args,
      );
    });
  }

  private static _subscribeTopic(
    name: string,
    bucketName: Input<string>,
    bucketArn: Input<string>,
    topicArn: Input<string>,
    args: BucketSubscriberArgs = {},
    opts: ComponentResourceOptions = {},
  ) {
    return all([bucketArn, topicArn, args]).apply(
      ([bucketArn, topicArn, args]) => {
        const subscriberId = this.buildSubscriberId(bucketArn, topicArn);

        return new BucketTopicSubscriber(
          `${name}Subscriber${subscriberId}`,
          {
            bucket: { name: bucketName, arn: bucketArn },
            topic: topicArn,
            subscriberId,
            ...args,
          },
          opts,
        );
      },
    );
  }

  private static buildSubscriberId(bucketArn: string, _discriminator: string) {
    return logicalName(
      hashStringToPrettyString(
        [
          bucketArn,
          // Temporarily only allowing one subscriber per bucket because of the
          // AWS/Terraform issue that appending/removing a notification deletes
          // all existing notifications.
          //
          // A solution would be to implement a dynamic provider. On create,
          // get existing notifications then append. And on delete, get existing
          // notifications then remove from the list.
          //
          // https://github.com/hashicorp/terraform-provider-aws/issues/501
          //
          // Commenting out the lines below to ensure the id never changes.
          // Because on id change, the removal of notification happens after
          // the creation of notification. And the newly created notification
          // gets removed.

          //...events,
          //args.filterPrefix ?? "",
          //args.filterSuffix ?? "",
          //discriminator,
        ].join(""),
        6,
      ),
    );
  }

  private ensureNotSubscribed() {
    if (this.isSubscribed)
      throw new VisibleError(
        `Cannot subscribe to the "${this.constructorName}" bucket multiple times. An S3 bucket can only have one subscriber.`,
      );
    this.isSubscribed = true;
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        name: this.name,
      },
      include: [
        permission({
          actions: ["s3:*"],
          resources: [this.arn, interpolate`${this.arn}/*`],
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Bucket";
// @ts-expect-error
Bucket.__pulumiType = __pulumiType;
