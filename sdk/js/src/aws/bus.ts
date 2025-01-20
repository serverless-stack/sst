import { AwsOptions, client } from "../aws/client.js";
import { Resource } from "../resource.js";
import { event } from "../event/index.js";
import { EventBridgeEvent, EventBridgeHandler, type Context } from "aws-lambda";

export module bus {
  export type Name = Extract<typeof Resource, { type: "sst.aws.Bus" }>["name"];

  function url(region?: string, options?: AwsOptions) {
    if (options?.region) region = options.region;
    return `https://events.${region}.amazonaws.com/`;
  }

  export function subscriber<Events extends event.Definition>(
    _events: Events | Events[],
    cb: (
      input: {
        [K in Events["type"]]: Extract<Events, { type: K }>["$payload"];
      }[Events["type"]],
      raw: EventBridgeEvent<string, any>,
      context: Context,
    ) => Promise<void>,
  ): EventBridgeHandler<string, any, void> {
    return async function (event, context) {
      const payload = {
        type: event["detail-type"],
        properties: event.detail.properties,
        metadata: event.detail.metadata,
      };
      return cb(payload, event, context);
    };
  }

  /** @deprecated
   * use bus.subscriber instead
   * */
  export const handler = subscriber;

  export async function publish<Definition extends event.Definition = any>(
    name: string | { name: string },
    def: Definition | string,
    properties: Definition["$input"],
    options?: {
      metadata?: Definition["$metadata"];
      aws?: AwsOptions;
    },
  ): Promise<any> {
    const c = await client();
    const u = url(c.region, options?.aws);
    const evt =
      typeof def === "string"
        ? {
            type: def,
            properties,
            metadata: options?.metadata || {},
          }
        : await def.create(properties, options?.metadata);
    const res = await c.fetch(u, {
      method: "POST",
      aws: options?.aws,
      headers: {
        "X-Amz-Target": "AWSEvents.PutEvents",
        "Content-Type": "application/x-amz-json-1.1",
      },
      body: JSON.stringify({
        Entries: [
          {
            Source: [Resource.App.name, Resource.App.stage].join("."),
            DetailType: evt.type,
            Detail: JSON.stringify({
              metadata: evt.metadata,
              properties: evt.properties,
            }),
            EventBusName: typeof name === "string" ? name : name.name,
          },
        ],
      }),
    });
    if (!res.ok) throw new PublishError(res);
    return res.json();
  }

  export class PublishError extends Error {
    constructor(public readonly response: Response) {
      super("Failed to publish event to bus");
    }
  }
}
