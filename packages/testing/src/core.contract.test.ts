import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";

test("Core exposes the versioned SayHi bootstrap contract", () => {
  assert.deepEqual(coreContract.readBootstrapContract(), {
    product: "SayHi",
    contractVersion: 1,
  });
});

test("Core round-trips valid shared domain values without information loss", () => {
  const cases = [
    { contractVersion: 1, kind: "identifier", value: "TASK-opaque/42" },
    {
      contractVersion: 1,
      kind: "timestamp",
      value: "2026-07-14T12:34:56.123456Z",
    },
    {
      contractVersion: 1,
      kind: "timestamp",
      value: "2026-07-14T00:00:00+00:00",
    },
    {
      contractVersion: 1,
      kind: "timestamp",
      value: "1990-12-31T23:59:60Z",
    },
    {
      contractVersion: 1,
      kind: "contentHash",
      value: { algorithm: "sha256-lf-v1", digest: "A".repeat(64) },
    },
    { contractVersion: 1, kind: "version", value: Number.MAX_SAFE_INTEGER },
    { contractVersion: 1, kind: "version", value: 0 },
  ] as const;

  for (const request of cases) {
    const result = coreContract.validateDomainValue(request);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.contractVersion, 1);
      assert.equal(result.kind, request.kind);
      assert.deepEqual(result.value, request.value);
    }
  }
});

test("Core preserves every field in a valid durable record envelope", () => {
  const envelope = {
    schemaVersion: 1,
    id: "TASK-42",
    createdAt: "2026-07-14T00:00:00Z",
    extension: { owner: "future-consumer", flags: ["one", "two"] },
  };

  assert.deepEqual(
    coreContract.validateDomainValue({
      contractVersion: 1,
      kind: "recordEnvelope",
      value: envelope,
    }),
    {
      ok: true,
      contractVersion: 1,
      kind: "recordEnvelope",
      value: envelope,
    },
  );
});

test("Core rejects durable record envelopes that JSON cannot preserve", () => {
  const cyclicEnvelope: Record<string, unknown> = { schemaVersion: 1 };
  cyclicEnvelope.self = cyclicEnvelope;
  const cases = [
    { schemaVersion: 1, extension: undefined },
    { schemaVersion: 1, count: Number.NaN },
    cyclicEnvelope,
  ];

  for (const value of cases) {
    assert.deepEqual(
      coreContract.validateDomainValue({
        contractVersion: 1,
        kind: "recordEnvelope",
        value,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [
          {
            code: "validation.record_envelope.invalid",
            path: "$.value",
            message:
              "Durable record envelope must contain only lossless JSON data.",
            remediation:
              "Remove undefined, non-finite numbers, accessors, cycles, and non-JSON values.",
          },
        ],
      },
    );
  }
});

test("Core does not execute record accessors during validation", () => {
  let reads = 0;
  const value = {
    get schemaVersion(): number {
      reads += 1;
      return 1;
    },
  };

  const result = coreContract.validateDomainValue({
    contractVersion: 1,
    kind: "recordEnvelope",
    value,
  });

  assert.equal(reads, 0);
  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "validation.record_envelope.invalid",
        path: "$.value",
        message: "Durable record envelope must contain only lossless JSON data.",
        remediation:
          "Remove undefined, non-finite numbers, accessors, cycles, and non-JSON values.",
      },
    ],
  });
});

test("Core does not execute request or content hash accessors", () => {
  let requestReads = 0;
  const request = {
    contractVersion: 1,
    kind: "identifier",
    get value(): string {
      requestReads += 1;
      return "TASK-42";
    },
  };

  assert.deepEqual(coreContract.validateDomainValue(request), {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "validation.request.invalid",
        path: "$.value",
        message: "Validation request value must be an enumerable data property.",
        remediation: "Provide value as plain data and retry.",
      },
    ],
  });
  assert.equal(requestReads, 0);

  let hashReads = 0;
  const contentHash = {
    get algorithm(): string {
      hashReads += 1;
      return "sha256-lf-v1";
    },
    digest: "a".repeat(64),
  };

  assert.deepEqual(
    coreContract.validateDomainValue({
      contractVersion: 1,
      kind: "contentHash",
      value: contentHash,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "validation.content_hash.invalid",
          path: "$.value",
          message: "Content hash must contain only lossless JSON data.",
          remediation: "Provide algorithm and digest as plain data properties.",
        },
      ],
    },
  );
  assert.equal(hashReads, 0);
});

test("Core rejects malformed and boundary-invalid shared domain values", () => {
  const cases = [
    ["identifier", "", "validation.identifier.invalid", "$.value"],
    [
      "timestamp",
      "2026-02-30T00:00:00Z",
      "validation.timestamp.invalid",
      "$.value",
    ],
    [
      "timestamp",
      "2026-07-14T00:00:00+08:00",
      "validation.timestamp.invalid",
      "$.value",
    ],
    [
      "timestamp",
      "2026-07-14T00:00:00-00:00",
      "validation.timestamp.invalid",
      "$.value",
    ],
    [
      "timestamp",
      "2026-07-14T12:00:60Z",
      "validation.timestamp.invalid",
      "$.value",
    ],
    [
      "timestamp",
      "2026-02-28T23:59:60Z",
      "validation.timestamp.invalid",
      "$.value",
    ],
    [
      "contentHash",
      { algorithm: "sha256-lf-v1", digest: "a".repeat(63) },
      "validation.content_hash.invalid",
      "$.value.digest",
    ],
    [
      "contentHash",
      { algorithm: "sha512-v1", digest: "a".repeat(64) },
      "validation.content_hash.algorithm_unsupported",
      "$.value.algorithm",
    ],
    ["version", -1, "validation.version.invalid", "$.value"],
    ["version", 1.5, "validation.version.invalid", "$.value"],
    ["version", -0, "validation.version.invalid", "$.value"],
    [
      "version",
      Number.MAX_SAFE_INTEGER + 1,
      "validation.version.invalid",
      "$.value",
    ],
    [
      "recordEnvelope",
      [],
      "validation.record_envelope.invalid",
      "$.value",
    ],
  ] as const;

  for (const [kind, value, code, path] of cases) {
    const result = coreContract.validateDomainValue({
      contractVersion: 1,
      kind,
      value,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
        })),
        [{ code, path }],
      );
      assert.match(result.diagnostics[0]?.message ?? "", /\S/u);
      assert.match(result.diagnostics[0]?.remediation ?? "", /\S/u);
    }
  }
});

test("Core returns a stable actionable diagnostic for a malformed request", () => {
  assert.deepEqual(
    coreContract.validateDomainValue({ contractVersion: 1, kind: "identifier" }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "validation.request.invalid",
          path: "$.value",
          message: "Validation request must include a value property.",
          remediation: "Provide the external value in the value property.",
        },
      ],
    },
  );
});

test("Core rejects unknown validation and record schema versions", () => {
  assert.deepEqual(
    coreContract.validateDomainValue({
      contractVersion: 2,
      kind: "identifier",
      value: "TASK-42",
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "validation.contract_version.unsupported",
          path: "$.contractVersion",
          message: "Validation contract version is not supported.",
          remediation: "Set contractVersion to 1 and retry.",
        },
      ],
    },
  );

  assert.deepEqual(
    coreContract.validateDomainValue({
      contractVersion: 1,
      kind: "recordEnvelope",
      value: { schemaVersion: 2, id: "TASK-42" },
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "validation.schema_version.unsupported",
          path: "$.value.schemaVersion",
          message: "Durable record schema version is not supported.",
          remediation: "Migrate the record to schemaVersion 1 and retry.",
        },
      ],
    },
  );
});

