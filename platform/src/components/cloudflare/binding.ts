/**
 * The Cloudflare Binding Linkable helper is used to define the Cloudflare bindings included
 * with the [`sst.Linkable`](/docs/component/linkable/) component.
 *
 * @example
 *
 * ```ts
 * sst.cloudflare.binding({
 *   type: "r2BucketBindings",
 *   properties: {
 *     bucketName: "my-bucket"
 *   }
 * })
 * ```
 *
 * @packageDocumentation
 */

import { Input } from "../input";
import type {
  WorkerScriptD1DatabaseBinding,
  WorkerScriptKvNamespaceBinding,
  WorkerScriptQueueBinding,
  WorkerScriptR2BucketBinding,
  WorkerScriptServiceBinding
} from "@pulumi/cloudflare/types/output";

export interface KvBinding {
  type: "kvNamespaceBindings";
  properties: {
    namespaceId: Input<string>;
  };
}

export interface SecretTextBinding {
  type: "secretTextBindings";
  properties: {
    text: Input<string>;
  };
}

export interface ServiceBinding {
  type: "serviceBindings";
  properties: {
    service: Input<string>;
  };
}

export interface PlainTextBinding {
  type: "plainTextBindings";
  properties: {
    text: Input<string>;
  };
}

export interface QueueBinding {
  type: "queueBindings";
  properties: {
    queue: Input<string>;
  };
}

export interface R2BucketBinding {
  type: "r2BucketBindings";
  properties: {
    bucketName: Input<string>;
  };
}

export interface D1DatabaseBinding {
  type: "d1DatabaseBindings";
  properties: {
    databaseId: Input<string>;
  };
}

export type Binding =
  | KvBinding
  | SecretTextBinding
  | ServiceBinding
  | PlainTextBinding
  | QueueBinding
  | R2BucketBinding
  | D1DatabaseBinding;

export function binding<T extends Binding["type"]>(input: Binding & {}) {
  return {
    type: "cloudflare.binding" as const,
    binding: input.type as T,
    properties: input.properties as Extract<Binding, { type: T }>["properties"],
  };
}

/**
 * @param bindingName - The name of the global variable for the binding in your Worker code.
 * @param cfBinding
 */
export function toWorkerScriptBinding(bindingName: Input<string>, cfBinding: ReturnType<typeof binding>): WorkerScriptKvNamespaceBinding | WorkerScriptServiceBinding | WorkerScriptQueueBinding | WorkerScriptR2BucketBinding | WorkerScriptD1DatabaseBinding {
  if (cfBinding.binding === "kvNamespaceBindings") {
    return {
      name: bindingName,
      ...cfBinding.properties,
    } as WorkerScriptKvNamespaceBinding;
  } else if (cfBinding.binding === "serviceBindings") {
    return {
      name: bindingName,
      ...cfBinding.properties,
    } as WorkerScriptServiceBinding;
  } else if (cfBinding.binding === "queueBindings") {
    return {
      binding: bindingName,
      ...cfBinding.properties,
    } as WorkerScriptQueueBinding;
  } else if (cfBinding.binding === "r2BucketBindings") {
    return {
      name: bindingName,
      ...cfBinding.properties,
    } as WorkerScriptR2BucketBinding;
  } else if (cfBinding.binding === "d1DatabaseBindings") {
    return {
      name: bindingName,
      ...cfBinding.properties,
    } as WorkerScriptD1DatabaseBinding;
  } else {
    throw new Error(`[Cloudflare]: Unsupported worker script binding type "${cfBinding.binding}"`);
  }
}
