export const DOMAIN_VALIDATION_CONTRACT_VERSION = 1 as const;
export const DURABLE_RECORD_SCHEMA_VERSION = 1 as const;

export type DomainValidationKind =
  | "identifier"
  | "timestamp"
  | "contentHash"
  | "version"
  | "recordEnvelope";

export type ContentHashAlgorithm = "sha256-lf-v1" | "sha256-bytes-v1";

export type ValidationDiagnosticCode =
  | "validation.request.invalid"
  | "validation.contract_version.unsupported"
  | "validation.kind.unsupported"
  | "validation.identifier.invalid"
  | "validation.timestamp.invalid"
  | "validation.content_hash.invalid"
  | "validation.content_hash.algorithm_unsupported"
  | "validation.version.invalid"
  | "validation.record_envelope.invalid"
  | "validation.schema_version.unsupported";

declare const identifierBrand: unique symbol;
declare const timestampBrand: unique symbol;
declare const versionBrand: unique symbol;

export type Identifier = string & { readonly [identifierBrand]: true };
export type Timestamp = string & { readonly [timestampBrand]: true };
export type Version = number & { readonly [versionBrand]: true };

export type ContentHash = Readonly<Record<string, unknown>> & {
  readonly algorithm: ContentHashAlgorithm;
  readonly digest: string;
};

export type DurableRecordEnvelope = Readonly<Record<string, unknown>> & {
  readonly schemaVersion: typeof DURABLE_RECORD_SCHEMA_VERSION;
};

export interface DomainValidationRequest {
  readonly contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
  readonly kind: DomainValidationKind;
  readonly value: unknown;
}

export interface ValidationDiagnostic {
  readonly code: ValidationDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly remediation: string;
}

export type DomainValidationSuccess =
  | Readonly<{
      ok: true;
      contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
      kind: "identifier";
      value: Identifier;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
      kind: "timestamp";
      value: Timestamp;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
      kind: "contentHash";
      value: ContentHash;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
      kind: "version";
      value: Version;
    }>
  | Readonly<{
      ok: true;
      contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
      kind: "recordEnvelope";
      value: DurableRecordEnvelope;
    }>;

export interface DomainValidationFailure {
  readonly ok: false;
  readonly contractVersion: typeof DOMAIN_VALIDATION_CONTRACT_VERSION;
  readonly diagnostics: readonly ValidationDiagnostic[];
}

export type DomainValidationResult =
  | DomainValidationSuccess
  | DomainValidationFailure;

type UnknownRecord = Record<string, unknown>;

const UTC_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|\+00:00)$/u;
const SHA256_DIGEST_PATTERN = /^[0-9a-f]{64}$/iu;

// IERS Bulletin 72 dates on which UTC second 60 actually occurred.
const KNOWN_UTC_LEAP_SECOND_DATES: readonly string[] = [
  "1972-06-30",
  "1972-12-31",
  "1973-12-31",
  "1974-12-31",
  "1975-12-31",
  "1976-12-31",
  "1977-12-31",
  "1978-12-31",
  "1979-12-31",
  "1981-06-30",
  "1982-06-30",
  "1983-06-30",
  "1985-06-30",
  "1987-12-31",
  "1989-12-31",
  "1990-12-31",
  "1992-06-30",
  "1993-06-30",
  "1994-06-30",
  "1995-12-31",
  "1997-06-30",
  "1998-12-31",
  "2005-12-31",
  "2008-12-31",
  "2012-06-30",
  "2015-06-30",
  "2016-12-31",
];

export function validateDomainValue(request: unknown): DomainValidationResult {
  try {
    return validateReadableDomainValue(request);
  } catch {
    return failure(
      "validation.request.invalid",
      "$",
      "Validation request could not be read safely.",
      "Provide a plain data object without accessors and retry.",
    );
  }
}

function validateReadableDomainValue(request: unknown): DomainValidationResult {
  if (!isRecord(request)) {
    return failure(
      "validation.request.invalid",
      "$",
      "Validation request must be an object.",
      "Provide contractVersion, kind, and value properties.",
    );
  }

  const contractVersionProperty = readOwnEnumerableDataProperty(
    request,
    "contractVersion",
  );
  if (contractVersionProperty === undefined) {
    return failure(
      "validation.request.invalid",
      "$.contractVersion",
      "Validation request must include contractVersion.",
      "Set contractVersion to 1 and retry.",
    );
  }
  if (contractVersionProperty === null) {
    return failure(
      "validation.request.invalid",
      "$.contractVersion",
      "Validation request contractVersion must be an enumerable data property.",
      "Provide contractVersion as plain data and retry.",
    );
  }

  const contractVersion = contractVersionProperty.value;
  if (!Number.isSafeInteger(contractVersion)) {
    return failure(
      "validation.request.invalid",
      "$.contractVersion",
      "Validation contract version must be a safe integer.",
      "Set contractVersion to 1 and retry.",
    );
  }
  if (contractVersion !== DOMAIN_VALIDATION_CONTRACT_VERSION) {
    return failure(
      "validation.contract_version.unsupported",
      "$.contractVersion",
      "Validation contract version is not supported.",
      "Set contractVersion to 1 and retry.",
    );
  }

  const kindProperty = readOwnEnumerableDataProperty(request, "kind");
  if (kindProperty === undefined) {
    return failure(
      "validation.request.invalid",
      "$.kind",
      "Validation request must include kind.",
      "Set kind to a supported shared domain value kind.",
    );
  }
  if (kindProperty === null) {
    return failure(
      "validation.request.invalid",
      "$.kind",
      "Validation request kind must be an enumerable data property.",
      "Provide kind as plain data and retry.",
    );
  }

  const kind = kindProperty.value;
  if (!isDomainValidationKind(kind)) {
    return failure(
      "validation.kind.unsupported",
      "$.kind",
      "Shared domain value kind is not supported.",
      "Use identifier, timestamp, contentHash, version, or recordEnvelope.",
    );
  }

  const valueProperty = readOwnEnumerableDataProperty(request, "value");
  if (valueProperty === undefined) {
    return failure(
      "validation.request.invalid",
      "$.value",
      "Validation request must include a value property.",
      "Provide the external value in the value property.",
    );
  }
  if (valueProperty === null) {
    return failure(
      "validation.request.invalid",
      "$.value",
      "Validation request value must be an enumerable data property.",
      "Provide value as plain data and retry.",
    );
  }

  const value = valueProperty.value;
  switch (kind) {
    case "identifier":
      return validateIdentifier(value);
    case "timestamp":
      return validateTimestamp(value);
    case "contentHash":
      return validateContentHash(value);
    case "version":
      return validateVersion(value);
    case "recordEnvelope":
      return validateRecordEnvelope(value);
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isIdentifier(value: unknown): value is string {
  return isNonEmptyString(value);
}

function validateIdentifier(value: unknown): DomainValidationResult {
  if (!isIdentifier(value)) {
    return failure(
      "validation.identifier.invalid",
      "$.value",
      "Identifier must be a non-empty string.",
      "Provide a stable, non-empty opaque identifier.",
    );
  }

  return {
    ok: true,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "identifier",
    value: value as Identifier,
  };
}

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && isValidUtcTimestamp(value);
}

function validateTimestamp(value: unknown): DomainValidationResult {
  if (!isTimestamp(value)) {
    return failure(
      "validation.timestamp.invalid",
      "$.value",
      "Timestamp must be a valid RFC 3339 UTC string.",
      "Provide a real calendar date and time ending in Z.",
    );
  }

  return {
    ok: true,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "timestamp",
    value: value as Timestamp,
  };
}

function validateContentHash(value: unknown): DomainValidationResult {
  if (!isRecord(value)) {
    return failure(
      "validation.content_hash.invalid",
      "$.value",
      "Content hash must be an object.",
      "Provide algorithm and digest properties.",
    );
  }
  if (!isLosslessJsonData(value)) {
    return failure(
      "validation.content_hash.invalid",
      "$.value",
      "Content hash must contain only lossless JSON data.",
      "Provide algorithm and digest as plain data properties.",
    );
  }

  const algorithm = readOwnEnumerableDataProperty(value, "algorithm")?.value;
  if (algorithm !== "sha256-lf-v1" && algorithm !== "sha256-bytes-v1") {
    if (typeof algorithm === "string") {
      return failure(
        "validation.content_hash.algorithm_unsupported",
        "$.value.algorithm",
        "Content hash algorithm is not supported.",
        "Use sha256-lf-v1 for normalized text or sha256-bytes-v1 for bytes.",
      );
    }

    return failure(
      "validation.content_hash.invalid",
      "$.value.algorithm",
      "Content hash algorithm must be a string.",
      "Provide sha256-lf-v1 or sha256-bytes-v1.",
    );
  }

  const digest = readOwnEnumerableDataProperty(value, "digest")?.value;
  if (typeof digest !== "string" || !SHA256_DIGEST_PATTERN.test(digest)) {
    return failure(
      "validation.content_hash.invalid",
      "$.value.digest",
      "Content hash digest must contain exactly 64 hexadecimal characters.",
      "Provide the complete SHA-256 digest without a prefix.",
    );
  }

  return {
    ok: true,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "contentHash",
    value: value as ContentHash,
  };
}

function validateVersion(value: unknown): DomainValidationResult {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    Object.is(value, -0)
  ) {
    return failure(
      "validation.version.invalid",
      "$.value",
      "Version must be a lossless non-negative safe integer.",
      "Provide an integer from 0 through Number.MAX_SAFE_INTEGER; do not use negative zero.",
    );
  }

  return {
    ok: true,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "version",
    value: value as Version,
  };
}

function validateRecordEnvelope(value: unknown): DomainValidationResult {
  if (!isRecord(value)) {
    return failure(
      "validation.record_envelope.invalid",
      "$.value",
      "Durable record envelope must be an object.",
      "Provide a JSON object with schemaVersion.",
    );
  }
  if (!isLosslessJsonData(value)) {
    return failure(
      "validation.record_envelope.invalid",
      "$.value",
      "Durable record envelope must contain only lossless JSON data.",
      "Remove undefined, non-finite numbers, accessors, cycles, and non-JSON values.",
    );
  }

  const schemaVersionProperty = readOwnEnumerableDataProperty(
    value,
    "schemaVersion",
  );
  if (schemaVersionProperty === undefined) {
    return failure(
      "validation.record_envelope.invalid",
      "$.value.schemaVersion",
      "Durable record envelope must include schemaVersion.",
      "Add schemaVersion: 1 and retry.",
    );
  }
  if (schemaVersionProperty === null) {
    return failure(
      "validation.record_envelope.invalid",
      "$.value.schemaVersion",
      "Durable record schemaVersion must be an enumerable data property.",
      "Provide schemaVersion as plain data and retry.",
    );
  }

  const schemaVersion = schemaVersionProperty.value;
  if (!Number.isSafeInteger(schemaVersion) || (schemaVersion as number) < 1) {
    return failure(
      "validation.record_envelope.invalid",
      "$.value.schemaVersion",
      "Durable record schemaVersion must be a positive safe integer.",
      "Set schemaVersion to 1 and retry.",
    );
  }
  if (schemaVersion !== DURABLE_RECORD_SCHEMA_VERSION) {
    return failure(
      "validation.schema_version.unsupported",
      "$.value.schemaVersion",
      "Durable record schema version is not supported.",
      "Migrate the record to schemaVersion 1 and retry.",
    );
  }

  return {
    ok: true,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    kind: "recordEnvelope",
    value: value as DurableRecordEnvelope,
  };
}

function isDomainValidationKind(value: unknown): value is DomainValidationKind {
  return (
    value === "identifier" ||
    value === "timestamp" ||
    value === "contentHash" ||
    value === "version" ||
    value === "recordEnvelope"
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLosslessJsonData(root: unknown): boolean {
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Object.is(value, -0)) {
        return false;
      }
      continue;
    }
    if (typeof value !== "object" || seen.has(value)) {
      return false;
    }

    seen.add(value);
    if (Array.isArray(value)) {
      if (!appendLosslessJsonArrayItems(value, pending)) {
        return false;
      }
      continue;
    }
    if (!appendLosslessJsonObjectValues(value, pending)) {
      return false;
    }
  }

  return true;
}

function appendLosslessJsonArrayItems(
  value: readonly unknown[],
  pending: unknown[],
): boolean {
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isEnumerableDataProperty(descriptor)) {
      return false;
    }
    pending.push(descriptor.value);
  }

  return true;
}

function appendLosslessJsonObjectValues(
  value: object,
  pending: unknown[],
): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      return false;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isEnumerableDataProperty(descriptor)) {
      return false;
    }
    pending.push(descriptor.value);
  }

  return true;
}

function isEnumerableDataProperty(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    descriptor !== undefined &&
    descriptor.enumerable === true &&
    Object.hasOwn(descriptor, "value")
  );
}

function readOwnEnumerableDataProperty(
  value: object,
  key: PropertyKey,
): (PropertyDescriptor & { value: unknown }) | null | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) {
    return undefined;
  }
  return isEnumerableDataProperty(descriptor) ? descriptor : null;
}

function isValidUtcTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const monthLength = daysInMonth(year, month);
  const isRegularSecond = second >= 0 && second <= 59;
  const isKnownLeapSecond =
    second === 60 &&
    hour === 23 &&
    minute === 59 &&
    KNOWN_UTC_LEAP_SECOND_DATES.includes(value.slice(0, 10));

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= monthLength &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    (isRegularSecond || isKnownLeapSecond)
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function failure(
  code: ValidationDiagnosticCode,
  path: string,
  message: string,
  remediation: string,
): DomainValidationFailure {
  return {
    ok: false,
    contractVersion: DOMAIN_VALIDATION_CONTRACT_VERSION,
    diagnostics: [{ code, path, message, remediation }],
  };
}
