import { createHash } from "node:crypto";

export type ContractIdentity = `sha256:${string}`;

export function isContractIdentity(value: unknown): value is ContractIdentity {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/iu.test(value);
}

export function hashCanonicalJson(value: unknown): ContractIdentity {
  const digest = createHash("sha256").update(stableJson(value)).digest("hex");
  return `sha256:${digest}`;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
