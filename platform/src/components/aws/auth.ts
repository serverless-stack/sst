import {
  ComponentResourceOptions,
  jsonStringify,
  Output,
} from "@pulumi/pulumi";
import { Component } from "../component";
import { Link } from "../link";
import { FunctionArgs, Function, Dynamo, CdnArgs, Router } from ".";
import { functionBuilder } from "./helpers/function-builder";
import { env } from "../linkable";
import { Auth as AuthV1 } from "./auth-v1";
import { Input } from "../input";

export interface AuthArgs {
  /**
   * The authorizer function.
   *
   * @example
   * ```js
   * {
   *   authorizer: "src/auth.handler"
   * }
   * ```
   */
  authorizer: Input<string | FunctionArgs>;
  /**
   * Set a custom domain for your Auth server.
   *
   * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
   * providers, you'll need to pass in a `cert` that validates domain ownership and add the
   * DNS records.
   *
   * :::tip
   * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
   * providers.
   * :::
   *
   * @example
   *
   * By default this assumes the domain is hosted on Route 53.
   *
   * ```js
   * {
   *   domain: "auth.example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "auth.example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   */
  domain?: CdnArgs["domain"];
  /**
   * Force upgrade from `Auth.v1` to the latest `Auth` version. The only valid value
   * is `v2`, which is the version of the new `Auth`.
   *
   * The latest `Auth` is powered by [OpenAuth](https://openauth.js.org). To
   * upgrade, add the prop.
   *
   * ```ts
   * {
   *   forceUpgrade: "v2"
   * }
   * ```
   *
   * Run `sst deploy`.
   *
   * :::tip
   * You can remove this prop after you upgrade.
   * :::
   *
   * This upgrades your component and the resources it created. You can now optionally
   * remove the prop.
   */
  forceUpgrade?: "v2";
}

/**
 * The `Auth` component lets you create centralized auth servers on AWS. It deploys
 * [OpenAuth](https://openauth.js.org) to [AWS Lambda](https://aws.amazon.com/lambda/)
 * and uses [Amazon DynamoDB](https://aws.amazon.com/dynamodb/) for storage.
 *
 * :::note
 * `Auth` and OpenAuth are currently in beta.
 * :::
 *
 * @example
 *
 * #### Create a Auth server
 *
 * ```ts title="sst.config.ts"
 * const auth = new sst.aws.Auth("MyAuth", {
 *   authorizer: "src/auth.handler"
 * });
 * ```
 *
 * #### Add a custom domain
 *
 * Set a custom domain for your Auth server.
 *
 * ```js {2} title="sst.config.ts"
 * new sst.aws.Auth("MyAuth", {
 *   authorizer: "src/auth.handler",
 *   domain: "auth.example.com"
 * });
 * ```
 */
export class Auth extends Component implements Link.Linkable {
  private readonly _table: Dynamo;
  private readonly _authorizer: Output<Function>;
  private readonly _router?: Router;
  public static v1 = AuthV1;

  constructor(name: string, args: AuthArgs, opts?: ComponentResourceOptions) {
    super(__pulumiType, name, args, opts);
    const _version = 2;
    const self = this;

    self.registerVersion({
      new: _version,
      old: $cli.state.version[name],
      message: [
        `There is a new version of "Auth" that has breaking changes.`,
        ``,
        `What changed:`,
        `  - The latest version is now powered by OpenAuth - https://openauth.js.org`,
        ``,
        `To upgrade:`,
        `  - Set \`forceUpgrade: "v${_version}"\` on the "Auth" component. Learn more https://sst.dev/docs/component/aws/auth#forceupgrade`,
        ``,
        `To continue using v${$cli.state.version[name]}:`,
        `  - Rename "Auth" to "Auth.v${$cli.state.version[name]}". Learn more about versioning - https://sst.dev/docs/components/#versioning`,
      ].join("\n"),
      forceUpgrade: args.forceUpgrade,
    });

    const table = createTable();
    const authorizer = createAuthorizer();
    const router = createRouter();

    this._table = table;
    this._authorizer = authorizer;
    this._router = router;
    registerOutputs();

    function registerOutputs() {
      self.registerOutputs({
        _hint: self.url,
      });
    }

    function createTable() {
      return new Dynamo(
        `${name}Storage`,
        {
          fields: { pk: "string", sk: "string" },
          primaryIndex: { hashKey: "pk", rangeKey: "sk" },
          ttl: "expiry",
        },
        { parent: self },
      );
    }

    function createAuthorizer() {
      return functionBuilder(
        `${name}Authorizer`,
        args.authorizer,
        {
          link: [table],
          environment: {
            OPENAUTH_STORAGE: jsonStringify({
              type: "dynamo",
              options: { table: table.name },
            }),
          },
          _skipHint: true,
        },
        (args) => {
          args.url = {
            cors: false,
          };
        },
        { parent: self },
      ).apply((v) => v.getFunction());
    }

    function createRouter() {
      if (!args.domain) return;

      return new Router(
        `${name}Router`,
        {
          domain: args.domain,
          routes: {
            "/*": authorizer.url,
          },
          _skipHint: true,
        },
        { parent: self },
      );
    }
  }

  /**
   * The URL of the Auth component.
   *
   * If the `domain` is set, this is the URL with the custom domain.
   * Otherwise, it's the autogenerated function URL for the authorizer.
   */
  public get url() {
    return (
      this._router?.url ?? this._authorizer.url.apply((v) => v.slice(0, -1))
    );
  }

  public get tableName() {
    return (
      this._table.name
    );
  }

  /**
   * The underlying [resources](/docs/components/#nodes) this component creates.
   */
  public get nodes() {
    return {
      /**
       * The DynamoDB component.
       */
      table: this._table,
      /**
       * The Function component for the authorizer.
       */
      authorizer: this._authorizer,
      /**
       * The Router component for the custom domain.
       */
      router: this._router,
    };
  }

  /** @internal */
  public getSSTLink() {
    return {
      properties: {
        url: this.url,
        tableName: this.tableName
      },
      include: [
        env({
          OPENAUTH_ISSUER: this.url,
        }),
      ],
    };
  }
}

const __pulumiType = "sst:aws:Auth";
// @ts-expect-error
Auth.__pulumiType = __pulumiType;
