/**
 * The Cloudflare DNS Adapter is used to create DNS records to manage domains hosted on
 * [Cloudflare DNS](https://developers.cloudflare.com/dns/).
 *
 * :::note
 * You need to [add the Cloudflare provider](/docs/providers/#install) to use this adapter.
 * :::
 *
 * This needs the Cloudflare provider. To add it run:
 *
 * ```bash
 * sst add cloudflare
 * ```
 *
 * This adapter is passed in as `domain.dns` when setting a custom domain, where `example.com`
 * is hosted on Cloudflare.
 *
 * ```ts
 * {
 *   domain: {
 *     name: "example.com",
 *     dns: sst.cloudflare.dns()
 *   }
 * }
 * ```
 *
 * Specify the zone ID.
 *
 * ```ts
 * {
 *   domain: {
 *     name: "example.com",
 *     dns: sst.cloudflare.dns({
 *       zone: "415e6f4653b6d95b775d350f32119abb"
 *     })
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

import * as cloudflare from "@pulumi/cloudflare";
import { AliasRecord, Dns, Record } from "../dns";
import { logicalName } from "../naming";
import { ZoneLookup } from "./providers/zone-lookup";
import { ComponentResourceOptions, output } from "@pulumi/pulumi";
import { Transform, transform } from "../component";
import { Input } from "../input";
import { DEFAULT_ACCOUNT_ID } from "./account-id";

export interface DnsArgs {
  /**
   * The ID of the Cloudflare zone to create the record in.
   *
   * @example
   * ```js
   * {
   *   zone: "415e6f4653b6d95b775d350f32119abb"
   * }
   * ```
   */
  zone?: Input<string>;
  /**
   * Set to `true` to allow the creation of new DNS records that can replace existing ones.
   *
   * This is useful for switching a domain to a new site without removing old DNS records,
   * helping to prevent downtime.
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   override: true
   * }
   * ```
   */
  override?: Input<boolean>;
  /**
   * Set to `true` to create a [proxied](https://developers.cloudflare.com/learning-paths/get-started-free/onboarding/proxy-dns-records/) record.
   *
   * :::tip
   * Proxied records help you prevent DDoS attacks and allow you to use Cloudflare's global content delivery network (CDN) for caching.
   * :::
   *
   * @default `false`
   * @example
   * ```js
   * {
   *   proxied: true
   * }
   * ```
   */
  proxied?: Input<boolean>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Cloudflare record resource.
     */
    record?: Transform<cloudflare.RecordArgs>;
  };
}

export function dns(args: DnsArgs = {}) {
  return {
    provider: "cloudflare",
    createAlias,
    createRecord,
  } satisfies Dns;

  function createAlias(
    namePrefix: string,
    record: AliasRecord,
    opts: ComponentResourceOptions,
  ) {
    return createRecord(
      namePrefix,
      {
        name: record.name,
        type: "CNAME",
        value: record.aliasName,
      },
      opts,
    );
  }

  function createRecord(
    namePrefix: string,
    record: Record,
    opts: ComponentResourceOptions,
  ) {
    return output(record).apply((record) => {
      const nameSuffix = logicalName(record.name);
      const zoneId = lookupZone();
      const dnsRecord = createRecord();
      return dnsRecord;

      function lookupZone() {
        if (args.zone) return args.zone;

        return new ZoneLookup(
          `${namePrefix}${record.type}ZoneLookup${nameSuffix}`,
          {
            accountId: DEFAULT_ACCOUNT_ID,
            domain: output(record.name).apply((name) =>
              name.replace(/\.$/, ""),
            ),
          },
          opts,
        ).id;
      }

      function createRecord() {
        const isACMCertificate = record.value.includes("acm-validations.aws")
        const proxied = args.proxied && !isACMCertificate;

        return new cloudflare.Record(
          ...transform(
            args.transform?.record,
            `${namePrefix}${record.type}Record${nameSuffix}`,
            {
              zoneId,
              proxied,
              name: record.name,
              content: record.value,
              type: record.type,
              ttl: proxied ? 1 : 60,
              allowOverwrite: args.override,
            },
            opts,
          ),
        );
      }
    });
  }
}
