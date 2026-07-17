import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";

const SHA256_A = `sha256:${"a".repeat(64)}`;
const CONTENT_HASH_A = {
  algorithm: "sha256-lf-v1",
  digest: "a".repeat(64),
} as const;
const CONTENT_HASH_B = {
  algorithm: "sha256-bytes-v1",
  digest: "b".repeat(64),
} as const;

const BASELINE_RECORD = {
  schemaVersion: 1,
  capturedAt: "2026-07-14T16:00:00Z",
  repositoryRootIdentity: "PROJECT-7",
  head: "1".repeat(40),
  indexDigest: `sha256:${"2".repeat(64)}`,
  trackedWorktreeDigest: `sha256:${"3".repeat(64)}`,
  untracked: [
    {
      path: "notes.txt",
      identity: {
        algorithm: "sha256-bytes-v1",
        digest: "4".repeat(64),
      },
    },
  ],
  submodulesDigest: `sha256:${"5".repeat(64)}`,
  dirtyPaths: [
    {
      path: "notes.txt",
      identity: `sha256:${"6".repeat(64)}`,
    },
  ],
  adoptedPaths: ["notes.txt"],
  declaredScope: {
    files: ["packages/testing/**"],
    apis: ["CoreContract"],
    schemas: [],
    locks: ["package-lock.json"],
  },
} as const;

const LEASE_RECORD = {
  schemaVersion: 1,
  leaseId: "LEASE-7",
  kind: "writer",
  projectId: "PROJECT-7",
  taskId: "TASK-7",
  owner: {
    sessionId: "SESSION-7",
    processId: 7007,
    hostId: "HOST-7",
    installId: "INSTALL-7",
  },
  baseFingerprint: `sha256:${"6".repeat(64)}`,
  acquiredAt: "2026-07-14T16:00:00Z",
  heartbeatAt: "2026-07-14T16:00:30Z",
  expiresAt: "2026-07-14T16:01:00Z",
} as const;

const AGENT_RESULT_RECORD = {
  schemaVersion: 1,
  dispatchId: "DISPATCH-7",
  taskId: "TASK-7",
  expectedTaskVersion: 2,
  phase: "explore",
  agentRole: "research",
  contextManifestIdentity: `sha256:${"7".repeat(64)}`,
  agentContractIdentity: `sha256:${"8".repeat(64)}`,
  baseFingerprint: `sha256:${"6".repeat(64)}`,
  outcome: "succeeded",
  artifacts: ["research/result.json"],
  evidence: ["evidence/validation.json"],
  findings: [],
  observedFinalFingerprint: `sha256:${"9".repeat(64)}`,
} as const;

const EVIDENCE_RECORD = {
  schemaVersion: 1,
  id: "EVIDENCE-7",
  taskId: "TASK-7",
  kind: "validation",
  producer: "sayhi-contract-suite",
  baseFingerprint: `sha256:${"a".repeat(64)}`,
  command: {
    argv: ["npm", "run", "test:contracts"],
    cwd: ".",
    exitCode: 0,
  },
  artifacts: [],
  result: "passed",
  startedAt: "2026-07-14T16:00:00Z",
  completedAt: "2026-07-14T16:01:00Z",
} as const;

const PROJECT_MANIFEST_RECORD = {
  schemaVersion: 1,
  projectId: "PROJECT-7",
  installed: {
    core: "0.0.0",
    cli: "0.0.0",
    ompPlugin: "0.0.0",
    projectSchema: 1,
    templates: "0.0.0",
    skillLockDigest: `sha256:${"b".repeat(64)}`,
  },
  initializedAt: "2026-07-14T16:00:00Z",
  updatedAt: "2026-07-14T16:00:00Z",
  ownershipManifest: ".sayhi/managed-files.json",
} as const;

test("Core round-trips every versioned knowledge, External Reference, Skill, and managed-file record", () => {
  const cases = [
    {
      kind: "knowledgeCandidate",
      record: {
        schemaVersion: 1,
        id: "KNOWLEDGE-42",
        taskId: "TASK-42",
        type: "convention",
        statement: "Public APIs return structured diagnostics.",
        scope: ["packages/core/**"],
        evidence: ["evidence/review.json"],
        confidence: "high",
        proposedAction: "update-spec",
        target: ".sayhi/spec/backend/api-guidelines.md",
        status: "pending",
        createdBy: "RESULT-KNOWLEDGE-42",
        extension: { source: "future-producer" },
      },
    },
    {
      kind: "externalReference",
      record: {
        schemaVersion: 1,
        id: "REFERENCE-42",
        kind: "issue",
        adapter: "github",
        uri: "https://github.com/dnslin/SayHi/issues/6",
        externalId: "6",
        observedVersion: "2026-07-14T00:44:12Z",
        role: "specification",
        identity: null,
        lastObservedAt: "2026-07-14T01:00:00Z",
      },
    },
    {
      kind: "skillLock",
      record: {
        schemaVersion: 1,
        registry: {
          repository: "https://github.com/dnslin/skills",
          commit: "1".repeat(40),
        },
        skills: [
          {
            name: "tdd",
            path: "tdd",
            files: [
              {
                path: "SKILL.md",
                sha256: {
                  algorithm: "sha256-bytes-v1",
                  digest: "2".repeat(64),
                },
              },
            ],
            upstream: {
              repository: "https://github.com/mattpocock/skills",
              commit: "3".repeat(40),
              path: "skills/engineering/tdd",
              license: "MIT",
            },
            sidecarIdentity: SHA256_A,
          },
        ],
      },
    },
    {
      kind: "managedFile",
      record: {
        schemaVersion: 1,
        path: ".sayhi/agents/implementation.md",
        ownershipClass: "engine-owned",
        installedBaseIdentity: CONTENT_HASH_B,
        generatedSourceVersion: "1.0.0",
        markerIds: [],
      },
    },
  ] as const;

  for (const { kind, record } of cases) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind,
      record,
    });

    assert.equal(result.ok, true, kind);
    if (result.ok) {
      assert.equal(result.contractVersion, 1);
      assert.equal(result.kind, kind);
      assert.deepEqual(result.record, record);
      assert.notStrictEqual(result.record, record);
      assert.match(result.identity, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.record), true);
    }
  }
});

test("Core enforces all managed-file ownership and installed-base identity rules", () => {
  const validRecords = [
    {
      schemaVersion: 1,
      path: ".sayhi/spec/user-owned.md",
      ownershipClass: "user-owned",
      generatedSourceVersion: "1.0.0",
      markerIds: [],
    },
    {
      schemaVersion: 1,
      path: ".sayhi/agents/customizable.md",
      ownershipClass: "managed-customizable",
      installedBaseIdentity: CONTENT_HASH_A,
      generatedSourceVersion: "1.0.0",
      markerIds: ["sayhi-agent-body"],
    },
  ] as const;

  for (const record of validRecords) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind: "managedFile",
      record,
    });
    assert.equal(result.ok, true, record.ownershipClass);
  }

  const base = {
    schemaVersion: 1,
    path: ".sayhi/agents/contract.md",
    generatedSourceVersion: "1.0.0",
    markerIds: [],
  };
  const invalidRecords = [
    [base, "record_contract.ownership.invalid", "$.record.ownershipClass"],
    [
      { ...base, ownershipClass: "engine-owned" },
      "record_contract.identity.invalid",
      "$.record.installedBaseIdentity",
    ],
    [
      { ...base, ownershipClass: "managed-customizable" },
      "record_contract.identity.invalid",
      "$.record.installedBaseIdentity",
    ],
    [
      { ...base, ownershipClass: "user-owned", installedBaseIdentity: CONTENT_HASH_A },
      "record_contract.ownership.invalid",
      "$.record.installedBaseIdentity",
    ],
    [
      {
        ...base,
        ownershipClass: "managed-customizable",
        installedBaseIdentity: CONTENT_HASH_A,
      },
      "record_contract.ownership.invalid",
      "$.record",
    ],
  ] as const;

  for (const [record, code, path] of invalidRecords) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind: "managedFile",
      record,
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
    }
  }
});

test("Core rejects unknown record versions and cross-contract identity mismatches", () => {
  const record = {
    schemaVersion: 1,
    id: "KNOWLEDGE-IDENTITY",
    taskId: "TASK-IDENTITY",
    type: "convention",
    statement: "Durable identities are exact.",
    scope: ["packages/core/**"],
    evidence: ["evidence/identity.json"],
    confidence: "high",
    proposedAction: "update-spec",
    target: ".sayhi/spec/identity.md",
    status: "pending",
    createdBy: "RESULT-IDENTITY",
  };
  const cases = [
    [
      { contractVersion: 2, kind: "knowledgeCandidate", record },
      "record_contract.contract_version.unsupported",
      "$.contractVersion",
    ],
    [
      {
        contractVersion: 1,
        kind: "knowledgeCandidate",
        record: { ...record, schemaVersion: 2 },
      },
      "record_contract.schema_version.unsupported",
      "$.record.schemaVersion",
    ],
    [
      {
        contractVersion: 1,
        kind: "knowledgeCandidate",
        record,
        expectedIdentity: SHA256_A,
      },
      "record_contract.identity.mismatch",
      "$.expectedIdentity",
    ],
    [
      {
        contractVersion: 1,
        kind: "knowledgeCandidate",
        record,
        expectedIdentity: "sha256:not-a-digest",
      },
      "record_contract.identity.invalid",
      "$.expectedIdentity",
    ],
  ] as const;

  for (const [request, code, path] of cases) {
    const result = coreContract.validateContractRecord(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(
        result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          path: diagnostic.path,
        })),
        [{ code, path }],
      );
    }
  }
});

test("Core rejects malformed records and duplicate immutable Skill identities", () => {
  const lockedSkill = {
    name: "tdd",
    path: "tdd",
    files: [
      {
        path: "SKILL.md",
        sha256: {
          algorithm: "sha256-bytes-v1",
          digest: "2".repeat(64),
        },
      },
    ],
    upstream: {
      repository: "https://github.com/mattpocock/skills",
      commit: "3".repeat(40),
      path: "skills/engineering/tdd",
      license: "MIT",
    },
    sidecarIdentity: SHA256_A,
  };
  const cases = [
    [
      "knowledgeCandidate",
      {
        schemaVersion: 1,
        id: "KNOWLEDGE-BAD",
        taskId: "TASK-BAD",
        type: "convention",
        statement: "Missing provenance is not durable knowledge.",
        scope: ["packages/core/**"],
        evidence: [],
        confidence: "high",
        proposedAction: "update-spec",
        target: ".sayhi/spec/bad.md",
        status: "pending",
        createdBy: "RESULT-BAD",
      },
      "record_contract.knowledge.invalid",
      "$.record.evidence",
    ],
    [
      "externalReference",
      {
        schemaVersion: 1,
        id: "REFERENCE-BAD",
        kind: "issue",
        adapter: "github",
        uri: "https://token@example.com/issues/6",
        externalId: "6",
        observedVersion: "v1",
        role: "specification",
        identity: null,
        lastObservedAt: "2026-07-14T01:00:00Z",
      },
      "record_contract.external_reference.invalid",
      "$.record.uri",
    ],
    [
      "skillLock",
      {
        schemaVersion: 1,
        registry: {
          repository: "https://github.com/dnslin/skills",
          commit: "1".repeat(40),
        },
        skills: [
          lockedSkill,
          {
            ...lockedSkill,
            path: "another-tdd",
            files: lockedSkill.files.map((file) => ({
              ...file,
              sha256: { ...file.sha256 },
            })),
            upstream: { ...lockedSkill.upstream },
          },
        ],
      },
      "record_contract.skill.duplicate",
      "$.record.skills[1]",
    ],
    [
      "skillLock",
      {
        schemaVersion: 1,
        registry: {
          repository: "https://github.com/dnslin/skills",
          commit: "latest",
        },
        skills: [lockedSkill],
      },
      "record_contract.skill_lock.invalid",
      "$.record.registry.commit",
    ],
    [
      "skillLock",
      {
        schemaVersion: 1,
        registry: {
          repository: "https://github.com/dnslin/skills",
          commit: "1".repeat(40),
        },
        skills: [
          {
            ...lockedSkill,
            files: lockedSkill.files.map((file) => ({ ...file })),
            upstream: { ...lockedSkill.upstream, commit: "main" },
          },
        ],
      },
      "record_contract.skill_lock.invalid",
      "$.record.skills[0].upstream.commit",
    ],
  ] as const;

  for (const [kind, record, code, path] of cases) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind,
      record,
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
    }
  }
});

test("Core does not execute accessors while validating contract records", () => {
  let reads = 0;
  const request = {
    kind: "managedFile",
    record: {
      schemaVersion: 1,
      path: ".sayhi/managed.md",
      ownershipClass: "user-owned",
      generatedSourceVersion: "1.0.0",
      markerIds: [],
    },
  };
  Object.defineProperty(request, "contractVersion", {
    enumerable: true,
    get: () => {
      reads += 1;
      return 1;
    },
  });

  const result = coreContract.validateContractRecord(request);

  assert.equal(result.ok, false);
  assert.equal(reads, 0);
  if (!result.ok) {
    assert.equal(result.diagnostics[0]?.code, "record_contract.request.invalid");
  }
});

test("Core requires algorithm-specific descriptors for Skill file content identities", () => {
  const byteIdentity = {
    algorithm: "sha256-bytes-v1",
    digest: "b".repeat(64),
  };
  const validRequest = {
    contractVersion: 1,
    kind: "skillLock",
    record: {
      schemaVersion: 1,
      registry: {
        repository: "https://github.com/dnslin/skills",
        commit: "1".repeat(40),
      },
      skills: [
        {
          name: "tdd",
          path: "tdd",
          files: [{ path: "SKILL.md", sha256: byteIdentity }],
          upstream: {
            repository: "https://github.com/mattpocock/skills",
            commit: "2".repeat(40),
            path: "skills/engineering/tdd",
            license: "MIT",
          },
          sidecarIdentity: SHA256_A,
        },
      ],
    },
  } as const;

  assert.equal(coreContract.validateContractRecord(validRequest).ok, true);
  assert.equal(
    coreContract.validateContractRecord({
      ...validRequest,
      record: {
        ...validRequest.record,
        skills: [
          {
            ...validRequest.record.skills[0],
            files: [{ path: "SKILL.md", sha256: "b".repeat(64) }],
          },
        ],
      },
    }).ok,
    false,
  );
});

test("Core requires algorithm-specific descriptors for managed-file content identities", () => {
  const validRequest = {
    contractVersion: 1,
    kind: "managedFile",
    record: {
      schemaVersion: 1,
      path: ".sayhi/agents/implementation.md",
      ownershipClass: "engine-owned",
      installedBaseIdentity: {
        algorithm: "sha256-lf-v1",
        digest: "a".repeat(64),
      },
      incomingUpdateIdentity: {
        algorithm: "sha256-bytes-v1",
        digest: "b".repeat(64),
      },
      generatedSourceVersion: "1.0.0",
      markerIds: [],
    },
  } as const;

  assert.equal(coreContract.validateContractRecord(validRequest).ok, true);
  assert.equal(
    coreContract.validateContractRecord({
      ...validRequest,
      record: {
        ...validRequest.record,
        installedBaseIdentity: SHA256_A,
      },
    }).ok,
    false,
  );
});

test("Core round-trips Baseline, Lease, Agent result, Evidence, and project manifest records", () => {
  const cases = [
    { kind: "baseline", record: BASELINE_RECORD },
    { kind: "lease", record: LEASE_RECORD },
    { kind: "agentResult", record: AGENT_RESULT_RECORD },
    { kind: "evidence", record: EVIDENCE_RECORD },
    { kind: "projectManifest", record: PROJECT_MANIFEST_RECORD },
  ] as const;

  for (const { kind, record } of cases) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind,
      record,
    });
    assert.equal(result.ok, true, kind);
    if (result.ok) {
      assert.equal(result.kind, kind);
      assert.deepEqual(result.record, record);
      assert.notStrictEqual(result.record, record);
      assert.match(result.identity, /^sha256:[0-9a-f]{64}$/u);
    }
  }
});

test("Core rejects malformed Baseline, Lease, Agent result, Evidence, and project manifest records", () => {
  const cases = [
    {
      kind: "baseline",
      record: { ...BASELINE_RECORD, head: "short" },
      code: "record_contract.baseline.invalid",
      path: "$.record.head",
    },
    {
      kind: "baseline",
      record: {
        ...BASELINE_RECORD,
        dirtyPaths: [{ path: "notes.txt", identity: "unversioned" }],
      },
      code: "record_contract.baseline.invalid",
      path: "$.record.dirtyPaths[0].identity",
    },
    {
      kind: "lease",
      record: {
        ...LEASE_RECORD,
        owner: { ...LEASE_RECORD.owner, processId: 0 },
      },
      code: "record_contract.lease.invalid",
      path: "$.record.owner.processId",
    },
    {
      kind: "agentResult",
      record: { ...AGENT_RESULT_RECORD, agentRole: "root" },
      code: "record_contract.agent_result.invalid",
      path: "$.record.agentRole",
    },
    {
      kind: "agentResult",
      record: { ...AGENT_RESULT_RECORD, baseFingerprint: "stale" },
      code: "record_contract.agent_result.invalid",
      path: "$.record.baseFingerprint",
    },

    {
      kind: "evidence",
      record: { ...EVIDENCE_RECORD, result: "successful" },
      code: "record_contract.evidence.invalid",
      path: "$.record.result",
    },
    {
      kind: "projectManifest",
      record: {
        ...PROJECT_MANIFEST_RECORD,
        installed: {
          ...PROJECT_MANIFEST_RECORD.installed,
          skillLockDigest: "unversioned",
        },
      },
      code: "record_contract.project_manifest.invalid",
      path: "$.record.installed.skillLockDigest",
    },
  ] as const;

  for (const { kind, record, code, path } of cases) {
    const result = coreContract.validateContractRecord({
      contractVersion: 1,
      kind,
      record,
    });
    assert.equal(result.ok, false, kind);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, code);
      assert.equal(result.diagnostics[0]?.path, path);
    }
  }
});

test("Core preserves accepted UTC leap seconds in ordered record timestamps", () => {
  const leaseResult = coreContract.validateContractRecord({
    contractVersion: 1,
    kind: "lease",
    record: {
      ...LEASE_RECORD,
      acquiredAt: "2016-12-31T23:59:60Z",
      heartbeatAt: "2017-01-01T00:00:00Z",
      expiresAt: "2017-01-01T00:00:01Z",
    },
  });
  assert.equal(leaseResult.ok, true);

  const evidenceResult = coreContract.validateContractRecord({
    contractVersion: 1,
    kind: "evidence",
    record: {
      ...EVIDENCE_RECORD,
      startedAt: "2016-12-31T23:59:60Z",
      completedAt: "2017-01-01T00:00:00Z",
    },
  });
  assert.equal(evidenceResult.ok, true);
});

test("Core requires structured actionable Review findings", () => {
  const actionableReview = {
    ...AGENT_RESULT_RECORD,
    phase: "review",
    agentRole: "spec-review",
    outcome: "blocked",
    findings: [
      {
        id: "FINDING-7",
        severity: "blocking",
        subject: "acceptance-criterion",
        reference: "Recovery reproduces the Task Projection",
        message: "The result omits the required recovery behavior.",
        remediation: "Persist and replay the recovery result before retrying Review.",
      },
    ],
  } as const;
  const accepted = coreContract.validateContractRecord({
    contractVersion: 1,
    kind: "agentResult",
    record: actionableReview,
  });
  assert.equal(accepted.ok, true);

  const unstructured = coreContract.validateContractRecord({
    contractVersion: 1,
    kind: "agentResult",
    record: { ...actionableReview, findings: ["Recovery behavior is missing."] },
  });
  assert.equal(unstructured.ok, false);
  if (!unstructured.ok) {
    assert.equal(
      unstructured.diagnostics[0]?.code,
      "record_contract.agent_result.invalid",
    );
    assert.equal(unstructured.diagnostics[0]?.path, "$.record.findings[0]");
  }
});
