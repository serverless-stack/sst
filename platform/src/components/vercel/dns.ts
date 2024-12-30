/**
 * The Vercel DNS Adapter is used to create DNS records to manage domains hosted on [Vercel](https://vercel.com/docs/projects/domains/working-with-domains).
 *
 * :::note
 * You need to [add the Vercel provider](/docs/all-providers#directory) to use this adapter.
 * :::
 *
 * This adapter is passed in as `domain.dns` when setting a custom domain; where `example.com`
 * is hosted on Vercel.
 *
 * ```ts
 * {
 *   domain: {
 *     name: "example.com",
 *     dns: sst.vercel.dns({
 *       domain: "example.com"
 *     })
 *   }
 * }
 * ```
 *
 * #### Configure provider
 *
 * 1. To use this component, add the `@pulumiverse/vercel` provider to your app.
 *
 *    ```bash
 *    sst add @pulumiverse/vercel
 *    ```
 *
 * 2. If you don't already have a Vercel Access Token, [follow this guide](https://vercel.com/guides/how-do-i-use-a-vercel-api-access-token#creating-an-access-token) to create one.
 *
 * 3. Add a `VERCEL_API_TOKEN` environment variable with the access token value. If the domain
 * belongs to a team, also add a `VERCEL_TEAM_ID` environment variable with the Team ID. You can
 * find your Team ID inside your team's general project settings in the Vercel dashboard.
 *
 * @packageDocumentation
 */

import { DnsRecord, DnsRecordArgs } from "@pulumiverse/vercel";
import { AliasRecord, Dns, Record } from "../dns";
import { logicalName } from "../naming";
import { ComponentResourceOptions, all } from "@pulumi/pulumi";
import { Transform, transform } from "../component";
import { Input } from "../input";
import { DEFAULT_TEAM_ID } from "./account-id";

export interface DnsArgs {
  /**
   * The domain name in your Vercel account to create the record in.
   *
   * @example
   * ```js
   * {
   *   domain: "example.com"
   * }
   * ```
   */
  domain: Input<string>;
  /**
   * [Transform](/docs/components#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    /**
     * Transform the Vercel record resource.
     */
    record?: Transform<DnsRecordArgs>;
  };
}

export function dns(args: DnsArgs) {
  return {
    provider: "vercel",
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
        // Cannot set CNAME record on the apex domain
        type: all([args.domain, record.name]).apply(([domain, recordName]) =>
          recordName.startsWith(domain) ? "ALIAS" : "CNAME",
        ),
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
    return all([args.domain, record]).apply(([domain, record]) => {
      const nameSuffix = logicalName(record.name);
      const recordName = validateRecordName();
      const dnsRecord = createRecord();
      return dnsRecord;

      function validateRecordName() {
        const recordName = record.name.replace(/\.$/, "");
        if (!recordName.endsWith(domain))
          throw new Error(
            `Record name "${recordName}" is not a subdomain of "${domain}".`,
          );
        return recordName.slice(0, -(domain.length + 1));
      }

      function createRecord() {
        return new DnsRecord(
          ...transform(
            args.transform?.record,
            `${namePrefix}${record.type}Record${nameSuffix}`,
            {
              domain: args.domain,
              type: record.type,
              name: recordName,
              value: record.value,
              teamId: DEFAULT_TEAM_ID,
              ttl: 60,
            },
            opts,
          ),
        );
      }
    });
  }
}
