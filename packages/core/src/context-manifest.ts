import { createHash } from "node:crypto";

import {
  DOMAIN_VALIDATION_CONTRACT_VERSION,
  isIdentifier,
  isNonEmptyString,
  validateDomainValue,
  type ContentHash,
  type ContentHashAlgorithm,
} from "./validation.js";
import { isRepositoryRelativePath } from "./repository-path.js";

export const CONTEXT_MANIFEST_CONTRACT_VERSION = 1 as const;

export type ContextTrustTier =
  | "engine-instruction"
  | "approved-spec"
  | "task-context"
  | "untrusted-reference";
export type ContextInjectionMode = "full" | "summary" | "pointer";
export type ContextInstructionPolicy = "scoped-instruction" | "data-only";

export interface ContextSource {
  readonly type: string;
  readonly value: string;
}

export interface ContextManifestEntry {
  readonly schemaVersion: typeof CONTEXT_MANIFEST_CONTRACT_VERSION;
  readonly id: string;
  readonly source: ContextSource;
  readonly kind: string;
  readonly reason: string;
  readonly required: boolean;
  readonly mode: ContextInjectionMode;
  readonly trust: ContextTrustTier;
  readonly instructionPolicy: ContextInstructionPolicy;
  readonly scope: readonly string[];
  readonly identity: ContentHash;
  readonly addedBy: string;
  readonly acceptedByEvent?: string;
}

export interface CurrentContextContent {
  readonly source: ContextSource;
  readonly content: string | Uint8Array;
}

export interface ContextManifestDiagnostic {
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type ContextManifestValidationResult =
  | Readonly<{ ok: true; entries: readonly ContextManifestEntry[] }>
  | Readonly<{ ok: false; diagnostics: readonly ContextManifestDiagnostic[] }>;

export type ParseContextManifestResult = ContextManifestValidationResult;

export function parseContextManifest(content: string): ParseContextManifestResult {
  const lines = content.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const values: unknown[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) {
      return invalid(`$[${index}]`, "Context Manifest JSONL cannot contain blank entries.");
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch {
      return invalid(
        `$[${index}]`,
        "Context Manifest contains malformed JSONL content.",
      );
    }
  }
  return validateContextManifestEntries(values);
}

export function serializeContextManifest(
  entries: readonly ContextManifestEntry[],
): string {
  return entries.length === 0
    ? ""
    : `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

export function validateContextManifestEntries(
  entries: readonly unknown[],
): ContextManifestValidationResult {
  const identifiers = new Set<string>();
  const accepted: ContextManifestEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) {
      return Object.freeze({
        ok: false,
        diagnostics: Object.freeze([
          invalidDiagnostic(
            `$[${index}]`,
            "Context Manifest cannot contain an empty entry.",
            "Remove array gaps and provide a complete Context Entry.",
          ),
        ]),
      });
    }
    const diagnostic = validateContextManifestEntry(entry, index, identifiers);
    if (diagnostic !== null) {
      return Object.freeze({ ok: false, diagnostics: Object.freeze([diagnostic]) });
    }
    accepted.push(freezeEntry(entry as ContextManifestEntry));
  }
  return Object.freeze({ ok: true, entries: Object.freeze(accepted) });
}

export function contentMatchesIdentity(
  content: string | Uint8Array,
  identity: ContentHash,
): boolean {
  const digest = createHash("sha256")
    .update(contentBytes(content, identity.algorithm))
    .digest("hex");
  return digest.toLowerCase() === identity.digest.toLowerCase();
}

export function hashTextContent(content: string): ContentHash {
  return Object.freeze({
    algorithm: "sha256-lf-v1",
    digest: createHash("sha256")
      .update(content.replace(/\r\n?/gu, "\n"))
      .digest("hex"),
  });
}

export function isContextTrustTier(value: unknown): value is ContextTrustTier {
  return (
    value === "engine-instruction" ||
    value === "approved-spec" ||
    value === "task-context" ||
    value === "untrusted-reference"
  );
}

function validateContextManifestEntry(
  entry: unknown,
  index: number,
  identifiers: Set<string>,
): ContextManifestDiagnostic | null {
  const path = `$[${index}]`;
  if (!isUnknownRecord(entry)) {
    return invalidDiagnostic(path, "Context Manifest entry must be an object.");
  }
  if (entry.schemaVersion !== CONTEXT_MANIFEST_CONTRACT_VERSION) {
    return invalidDiagnostic(
      `${path}.schemaVersion`,
      "Context Manifest entry schema version is unsupported.",
      "Regenerate the Manifest with entry schemaVersion 1.",
    );
  }
  if (!isIdentifier(entry.id) || identifiers.has(entry.id)) {
    return invalidDiagnostic(
      `${path}.id`,
      "Context Manifest entry ID is invalid or duplicated.",
      "Provide one unique non-empty ID per Context Entry.",
    );
  }
  identifiers.add(entry.id);
  if (
    !isUnknownRecord(entry.source) ||
    !isNonEmptyString(entry.source.type) ||
    !isNonEmptyString(entry.source.value)
  ) {
    return invalidDiagnostic(
      `${path}.source`,
      "Context Manifest entry source is invalid.",
      "Provide a typed source with a non-empty value.",
    );
  }
  if (
    entry.source.type === "project-path" &&
    !isRepositoryRelativePath(entry.source.value)
  ) {
    return invalidDiagnostic(
      `${path}.source.value`,
      "Project-path Context source must stay inside the repository.",
      "Use a normalized repository-relative path without dot segments.",
    );
  }
  if (!isNonEmptyString(entry.kind) || !isNonEmptyString(entry.reason)) {
    return invalidDiagnostic(
      path,
      "Context Manifest entry kind and reason are required.",
      "Describe the Context Entry kind and why the Phase needs it.",
    );
  }
  if (typeof entry.required !== "boolean") {
    return invalidDiagnostic(
      `${path}.required`,
      "Context Manifest entry required flag must be boolean.",
      "Set required to true or false.",
    );
  }
  if (entry.mode !== "full" && entry.mode !== "summary" && entry.mode !== "pointer") {
    return invalidDiagnostic(
      `${path}.mode`,
      "Context Manifest entry has an unsupported injection mode.",
      "Use full, summary, or pointer.",
    );
  }
  if (!isContextTrustTier(entry.trust)) {
    return invalidDiagnostic(
      `${path}.trust`,
      "Context Manifest entry has an unsupported Trust Tier.",
      "Use engine-instruction, approved-spec, task-context, or untrusted-reference.",
    );
  }
  if (
    entry.instructionPolicy !== "scoped-instruction" &&
    entry.instructionPolicy !== "data-only"
  ) {
    return invalidDiagnostic(
      `${path}.instructionPolicy`,
      "Context Manifest entry has an unsupported instruction policy.",
      "Use scoped-instruction or data-only.",
    );
  }
  if (
    (entry.trust === "task-context" || entry.trust === "untrusted-reference") &&
    entry.instructionPolicy !== "data-only"
  ) {
    return invalidDiagnostic(
      `${path}.instructionPolicy`,
      "Only Engine Instruction and Approved Spec entries may carry instruction authority.",
      "Set instructionPolicy to data-only for Task Context and Untrusted Reference entries.",
    );
  }
  if (
    !Array.isArray(entry.scope) ||
    !entry.scope.every((scope) => isRepositoryRelativePath(scope))
  ) {
    return invalidDiagnostic(
      `${path}.scope`,
      "Context Manifest entry scope must contain repository-relative patterns.",
      "Use '/' paths without absolute roots, backslashes, or '..' traversal.",
    );
  }
  if (
    !validateDomainValue({
      contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
      kind: "contentHash",
      value: entry.identity,
    }).ok
  ) {
    return invalidDiagnostic(
      `${path}.identity`,
      "Context Manifest entry content identity is invalid.",
      "Use a supported SHA-256 content identity with a 64-character hexadecimal digest.",
    );
  }
  if (
    !isIdentifier(entry.addedBy) ||
    (entry.acceptedByEvent !== undefined && !isIdentifier(entry.acceptedByEvent))
  ) {
    return invalidDiagnostic(
      path,
      "Context Manifest entry provenance is invalid.",
      "Provide valid addedBy and optional acceptedByEvent identifiers.",
    );
  }
  return null;
}

function freezeEntry(entry: ContextManifestEntry): ContextManifestEntry {
  return Object.freeze({
    ...entry,
    source: Object.freeze({ ...entry.source }),
    scope: Object.freeze([...entry.scope]),
    identity: Object.freeze({ ...entry.identity }),
  });
}

function contentBytes(
  content: string | Uint8Array,
  algorithm: ContentHashAlgorithm,
): string | Uint8Array {
  if (algorithm === "sha256-bytes-v1") {
    return content;
  }
  const text = typeof content === "string" ? content : new TextDecoder().decode(content);
  return text.replace(/\r\n?/gu, "\n");
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, message: string): ContextManifestValidationResult {
  return Object.freeze({
    ok: false,
    diagnostics: Object.freeze([invalidDiagnostic(path, message)]),
  });
}

function invalidDiagnostic(
  path: string,
  message: string,
  remediation = "Repair the Context Manifest entry and retry.",
): ContextManifestDiagnostic {
  return Object.freeze({ path, message, remediation });
}
