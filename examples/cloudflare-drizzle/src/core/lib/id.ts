/* https://jsr.io/@std/ulid */
import { ulid } from "@std/ulid";

const prefixes = {
  account: "acc",
} as const;

export function createId(prefix: keyof typeof prefixes): string {
  return `${prefixes[prefix]}_${ulid()}`;
}
