import { event } from "sst/event";
import crypto from "node:crypto";
import { z } from "zod";

export const defineEvent = event.builder({
  validator: (schema) => {
    return (input) => {
      return schema.parse(input);
    };
  },
  metadata: () => {
    return {
      idempotencyKey: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
  },
});

export const testEvent = defineEvent(
  "test",
  z.object({
    message: z.string(),
  })
);
