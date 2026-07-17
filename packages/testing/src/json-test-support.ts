import assert from "node:assert/strict";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    assert.fail(`${label} must be a JSON object.`);
  }
  return value;
}

export function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    assert.fail(`${field} must be a string.`);
  }
  return value;
}

export function requireVersion(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    assert.fail(`${field} must be a positive safe integer.`);
  }
  return value;
}