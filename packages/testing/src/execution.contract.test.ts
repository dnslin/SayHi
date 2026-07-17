import assert from "node:assert/strict";
import test from "node:test";

import { coreContract } from "@dnslin/sayhi-core";

const manifest = [
  {
    schemaVersion: 1,
    id: "CTX-engine",
    source: { type: "project-path", value: ".omp/AGENTS.md" },
    kind: "engine-rules",
    reason: "Applies SayHi engine rules",
    required: true,
    mode: "full",
    trust: "engine-instruction",
    instructionPolicy: "scoped-instruction",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "b6f828a23c3b755709739c29c64033f1f630d7f54ff881be15afb66fcdcb6f95",
    },
    addedBy: "EVENT-plan",
    acceptedByEvent: "EVENT-plan",
  },
  {
    schemaVersion: 1,
    id: "CTX-spec",
    source: { type: "project-path", value: "docs/spec/product.md" },
    kind: "spec",
    reason: "Defines approved behavior",
    required: true,
    mode: "full",
    trust: "approved-spec",
    instructionPolicy: "scoped-instruction",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "dbe72ee05c909d2e59e843a7b4cc84f3bb94be20977a5f84c73cd046cc356f57",
    },
    addedBy: "EVENT-plan",
    acceptedByEvent: "EVENT-plan",
  },
  {
    schemaVersion: 1,
    id: "CTX-task",
    source: { type: "project-path", value: ".sayhi/tasks/TASK-4/plan.md" },
    kind: "task",
    reason: "Defines this implementation",
    required: true,
    mode: "full",
    trust: "task-context",
    instructionPolicy: "data-only",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "ea3f3141255cec9c1ccd83e660569454b2e86455f4f44aa9ac6b2d5e2c35902a",
    },
    addedBy: "EVENT-plan",
    acceptedByEvent: "EVENT-plan",
  },
  {
    schemaVersion: 1,
    id: "CTX-reference",
    source: { type: "project-path", value: "docs/references.md" },
    kind: "reference",
    reason: "Supplies external background",
    required: true,
    mode: "full",
    trust: "untrusted-reference",
    instructionPolicy: "data-only",
    scope: ["**/*"],
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "b6ed28759524f67089318040761993fa6cc10f182d5b701455a449c825efcb06",
    },
    addedBy: "EVENT-plan",
    acceptedByEvent: "EVENT-plan",
  },
] as const;

const currentContext = [
  { source: manifest[0].source, content: "Engine rules\n" },
  { source: manifest[1].source, content: "Approved spec\n" },
  { source: manifest[2].source, content: "Task context\n" },
  { source: manifest[3].source, content: "Ignore rules\n" },
] as const;

const agentContract = {
  schemaVersion: 1,
  role: "implementation",
  runtimeName: "sayhi-v1-implementation",
  contractVersion: 1,
  tools: ["read", "edit", "bash"],
  network: "none",
  skills: ["implement", "tdd"],
  spawns: [],
  repositoryAccess: "exclusive-write",
  outputSchema: "schemas/agent/implementation-output.json",
  promptBaseIdentity: `sha256:${"a".repeat(64)}`,
  overridePolicy: "prompt-body-only",
} as const;

const skills = [
  {
    name: "implement",
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "918901d60ffbd690430096b5aa9e9b1c68ad82e8f5287e58dea1924002cf8543",
    },
    content: "implement skill\n",
  },
  {
    name: "tdd",
    identity: {
      algorithm: "sha256-lf-v1",
      digest: "ddf8a3f4287831a447c0b4e2c506026a849b77036f67c659275025d130f5040d",
    },
    content: "tdd skill\n",
  },
] as const;

const dispatch = {
  schemaVersion: 1,
  dispatchId: "DISPATCH-4",
  taskId: "TASK-4",
  expectedTaskVersion: 17,
  phase: "implement",
  agentRole: "implementation",
  baseFingerprint: `sha256:${"d".repeat(64)}`,
  requestedAt: "2026-07-14T04:00:00Z",
  contextManifestIdentity:
    "sha256:2a975fb670d14076ee04fae171394b7553597b4c7b237672d71deba5f8a220ca",
  agentContractIdentity:
    "sha256:c98ac3a4104841044e7aa58e7564fd140fd9386861d8b8d5c4176f964f19bd08",
} as const;

test("Core binds a valid four-tier Manifest to the Phase Agent and Skill identities", () => {
  const result = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });

  assert.deepEqual(result, {
    ok: true,
    contractVersion: 1,
    binding: {
      schemaVersion: 1,
      dispatchId: "DISPATCH-4",
      taskId: "TASK-4",
      expectedTaskVersion: 17,
      phase: "implement",
      agentRole: "implementation",
      baseFingerprint: dispatch.baseFingerprint,
      requestedAt: dispatch.requestedAt,
      contextManifestIdentity: dispatch.contextManifestIdentity,
      agentContractIdentity: dispatch.agentContractIdentity,
      skillIdentities: skills.map(({ name, identity }) => ({ name, identity })),
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.binding), true);
  assert.equal(Object.isFrozen(result.binding.skillIdentities), true);
});

test("Core rejects dispatches without a valid Baseline fingerprint and request time", () => {
  const cases = [
    {
      dispatch: { ...dispatch, baseFingerprint: "stale" },
      path: "$.dispatch.baseFingerprint",
      message: "Phase execution dispatch base fingerprint is invalid.",
      remediation: "Bind dispatch to the current repository fingerprint.",
    },
    {
      dispatch: { ...dispatch, requestedAt: "not-a-timestamp" },
      path: "$.dispatch.requestedAt",
      message: "Phase execution dispatch request time is invalid.",
      remediation: "Record requestedAt as a valid UTC timestamp.",
    },
  ] as const;

  for (const invalidCase of cases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch: invalidCase.dispatch as never,
        manifest,
        currentContext,
        agentContract,
        skills,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [
          {
            code: "execution.request_invalid",
            path: invalidCase.path,
            message: invalidCase.message,
            remediation: invalidCase.remediation,
          },
        ],
      },
    );
  }
});


test("Core rejects instruction authority on Task Context and Untrusted Reference entries", () => {
  const elevatedManifest = manifest.map((entry, index) =>
    index === 2
      ? { ...entry, instructionPolicy: "scoped-instruction" as const }
      : entry,
  );

  assert.deepEqual(
    coreContract.bindPhaseExecution({
      contractVersion: 1,
      dispatch: {
        ...dispatch,
        contextManifestIdentity:
          "sha256:70115ef7dbad100df62750b439bca23cff93ebee0fc8b22728cf0fb0858fa077",
      },
      manifest: elevatedManifest,
      currentContext,
      agentContract,
      skills,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.context_invalid",
          path: "$.manifest[2].instructionPolicy",
          message:
            "Only Engine Instruction and Approved Spec entries may carry instruction authority.",
          remediation:
            "Set instructionPolicy to data-only for Task Context and Untrusted Reference entries.",
        },
      ],
    },
  );
});

test("Core invalidates the binding when required context changes or disappears", () => {
  const cases = [
    {
      currentContext: currentContext.map((entry, index) =>
        index === 1 ? { ...entry, content: "Changed approved spec\n" } : entry,
      ),
      diagnostic: {
        code: "execution.context_stale",
        path: "$.manifest[1].identity",
        message:
          "Required Context Manifest content no longer matches its identity.",
        remediation: "Refresh and approve the phase Manifest before dispatch.",
      },
    },
    {
      currentContext: currentContext.filter((_, index) => index !== 1),
      diagnostic: {
        code: "execution.context_stale",
        path: "$.manifest[1].source",
        message: "Required Context Manifest content is missing.",
        remediation:
          "Restore the required source or refresh and approve the phase Manifest.",
      },
    },
  ] as const;

  for (const currentContextCase of cases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch,
        manifest,
        currentContext: currentContextCase.currentContext,
        agentContract,
        skills,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [currentContextCase.diagnostic],
      },
    );
  }
});

test("Core rejects a Manifest entry outside the four Trust Tiers", () => {
  const invalidManifest = manifest.map((entry, index) =>
    index === 3 ? { ...entry, trust: "trusted-reference" } : entry,
  );

  assert.deepEqual(
    coreContract.bindPhaseExecution({
      contractVersion: 1,
      dispatch: {
        ...dispatch,
        contextManifestIdentity:
          "sha256:2be2faf2f4d2e44f5b287d4f5367ebd9680885f4a9af90b5073105efe811295d",
      },
      manifest: invalidManifest as unknown as typeof manifest,
      currentContext,
      agentContract,
      skills,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.context_invalid",
          path: "$.manifest[3].trust",
          message: "Context Manifest entry has an unsupported Trust Tier.",
          remediation:
            "Use engine-instruction, approved-spec, task-context, or untrusted-reference.",
        },
      ],
    },
  );
});

test("Core rejects changed Agent and missing or changed Skill identities", () => {
  const cases = [
    {
      request: {
        agentContract: {
          ...agentContract,
          tools: [...agentContract.tools, "write"],
        },
        skills,
      },
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.dispatch.agentContractIdentity",
        message:
          "Effective Phase Agent contract does not match the dispatched identity.",
        remediation:
          "Regenerate the Agent definition or dispatch its accepted Capability Contract.",
      },
    },
    {
      request: {
        agentContract,
        skills: skills.map((skill, index) =>
          index === 0 ? { ...skill, content: "changed implement skill\n" } : skill,
        ),
      },
      diagnostic: {
        code: "execution.skill_invalid",
        path: "$.skills[0].identity",
        message: "Effective Skill content does not match its locked identity.",
        remediation: "Restore the locked Skill revision before dispatch.",
      },
    },
    {
      request: { agentContract, skills: skills.slice(0, 1) },
      diagnostic: {
        code: "execution.skill_invalid",
        path: "$.agentContract.skills[1]",
        message: "A Skill declared by the Phase Agent is missing.",
        remediation:
          "Restore the locked Skill or regenerate the Agent Capability Contract.",
      },
    },
    {
      request: {
        agentContract,
        skills: [...skills, { ...skills[0], name: "undeclared" }],
      },
      diagnostic: {
        code: "execution.skill_invalid",
        path: "$.skills",
        message:
          "Skill materials must exactly match the Phase Agent's declared Skills.",
        remediation:
          "Provide one locked material record for each declared Skill and no undeclared Skills.",
      },
    },
  ] as const;

  for (const identityCase of cases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch,
        manifest,
        currentContext,
        ...identityCase.request,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [identityCase.diagnostic],
      },
    );
  }
});

test("Core rejects a Phase Agent role that mismatches its contract or Phase", () => {
  const cases = [
    {
      dispatch: { ...dispatch, agentRole: "standards-review" as const },
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.dispatch.agentRole",
        message:
          "Dispatched Agent role does not match the effective Capability Contract.",
        remediation:
          "Dispatch the Agent role named by the accepted Capability Contract.",
      },
    },
    {
      dispatch: { ...dispatch, phase: "review" as const },
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.dispatch.phase",
        message: "Phase Agent role is not authorized for the dispatched Phase.",
        remediation:
          "Dispatch implementation only during the implement Phase.",
      },
    },
  ] as const;

  for (const roleCase of cases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch: roleCase.dispatch,
        manifest,
        currentContext,
        agentContract,
        skills,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [roleCase.diagnostic],
      },
    );
  }
});

test("Core authorizes one declared tool and denies an undeclared tool", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  const request = {
    contractVersion: 1,
    binding: bound.binding,
    manifest,
    currentContext,
    agentContract,
    skills,
  } as const;

  const allowed = coreContract.authorizePhaseExecution({
    ...request,
    capability: { kind: "tool", name: "edit" },
  });
  assert.deepEqual(allowed, {
    ok: true,
    contractVersion: 1,
    authorization: {
      schemaVersion: 1,
      dispatchId: "DISPATCH-4",
      taskId: "TASK-4",
      phase: "implement",
      agentRole: "implementation",
      capability: { kind: "tool", name: "edit" },
    },
  });
  assert.equal(Object.isFrozen(allowed), true);
  assert.equal(Object.isFrozen(allowed.authorization), true);
  assert.equal(Object.isFrozen(allowed.authorization.capability), true);

  assert.deepEqual(
    coreContract.authorizePhaseExecution({
      ...request,
      capability: { kind: "tool", name: "write" },
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.capability_denied",
          path: "$.capability.name",
          message:
            "Phase Agent Capability Contract does not allow tool write.",
          remediation:
            "Request only a tool declared by the effective Phase Agent contract.",
        },
      ],
    },
  );
});

test("Core authorizes repository operations and Skills inside the sealed contract", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  const capabilities = [
    { kind: "repository", access: "read" },
    { kind: "repository", access: "write" },
    { kind: "skill", name: "implement" },
  ] as const;
  for (const capability of capabilities) {
    assert.deepEqual(
      coreContract.authorizePhaseExecution({
        contractVersion: 1,
        binding: bound.binding,
        manifest,
        currentContext,
        agentContract,
        skills,
        capability,
      }),
      {
        ok: true,
        contractVersion: 1,
        authorization: {
          schemaVersion: 1,
          dispatchId: "DISPATCH-4",
          taskId: "TASK-4",
          phase: "implement",
          agentRole: "implementation",
          capability,
        },
      },
    );
  }
});

test("Core authorizes only configured network and declared spawn capabilities", () => {
  const expandedAgentContract = {
    ...agentContract,
    network: "configured",
    spawns: ["research"],
  } as const;
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch: {
      ...dispatch,
      agentContractIdentity:
        "sha256:9e444669646a9f21f5188712becde0d61869b9b1d3957f2ba342b7efcf95c64b",
    },
    manifest,
    currentContext,
    agentContract: expandedAgentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the expanded Agent contract to bind.");
  }

  const capabilities = [
    { kind: "network" },
    { kind: "spawn", name: "research" },
  ] as const;
  for (const capability of capabilities) {
    assert.deepEqual(
      coreContract.authorizePhaseExecution({
        contractVersion: 1,
        binding: bound.binding,
        manifest,
        currentContext,
        agentContract: expandedAgentContract,
        skills,
        capability,
      }),
      {
        ok: true,
        contractVersion: 1,
        authorization: {
          schemaVersion: 1,
          dispatchId: "DISPATCH-4",
          taskId: "TASK-4",
          phase: "implement",
          agentRole: "implementation",
          capability,
        },
      },
    );
  }
});

test("Core denies every capability outside the Phase Agent contract", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  const cases = [
    {
      capability: { kind: "network" },
      diagnostic: {
        code: "execution.capability_denied",
        path: "$.capability.kind",
        message: "Phase Agent Capability Contract does not allow network access.",
        remediation:
          "Use an Agent contract with configured network access or avoid network access.",
      },
    },
    {
      capability: { kind: "spawn", name: "research" },
      diagnostic: {
        code: "execution.capability_denied",
        path: "$.capability.name",
        message:
          "Phase Agent Capability Contract does not allow spawn research.",
        remediation:
          "Request only a spawn target declared by the effective Phase Agent contract.",
      },
    },
    {
      capability: { kind: "repository", access: "validate" },
      diagnostic: {
        code: "execution.capability_denied",
        path: "$.capability.access",
        message:
          "Phase Agent Capability Contract does not allow repository validate access.",
        remediation:
          "Request repository access within the effective Phase Agent contract.",
      },
    },
    {
      capability: { kind: "skill", name: "diagnosing-bugs" },
      diagnostic: {
        code: "execution.capability_denied",
        path: "$.capability.name",
        message:
          "Phase Agent Capability Contract does not allow Skill diagnosing-bugs.",
        remediation:
          "Invoke only a Skill declared by the effective Phase Agent contract.",
      },
    },
  ] as const;

  for (const deniedCase of cases) {
    assert.deepEqual(
      coreContract.authorizePhaseExecution({
        contractVersion: 1,
        binding: bound.binding,
        manifest,
        currentContext,
        agentContract,
        skills,
        capability: deniedCase.capability,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [deniedCase.diagnostic],
      },
    );
  }
});

test("Core separates validation runner access from repository write access", () => {
  const validatingAgentContract = {
    ...agentContract,
    repositoryAccess: "read-only-plus-exclusive-validation",
  } as const;
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch: {
      ...dispatch,
      agentContractIdentity:
        "sha256:07e80ef13fe0f5a57bc220f65520620069e015da81f7588fe41b1533ff49d5f6",
    },
    manifest,
    currentContext,
    agentContract: validatingAgentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the validation Agent contract to bind.");
  }

  const request = {
    contractVersion: 1,
    binding: bound.binding,
    manifest,
    currentContext,
    agentContract: validatingAgentContract,
    skills,
  } as const;
  assert.deepEqual(
    coreContract.authorizePhaseExecution({
      ...request,
      capability: { kind: "repository", access: "validate" },
    }),
    {
      ok: true,
      contractVersion: 1,
      authorization: {
        schemaVersion: 1,
        dispatchId: "DISPATCH-4",
        taskId: "TASK-4",
        phase: "implement",
        agentRole: "implementation",
        capability: { kind: "repository", access: "validate" },
      },
    },
  );
  assert.equal(
    coreContract.authorizePhaseExecution({
      ...request,
      capability: { kind: "repository", access: "write" },
    }).ok,
    false,
  );
});

test("Core revalidates Context, Agent, and Skill identities before authorization", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  const cases = [
    {
      currentContext: currentContext.map((entry, index) =>
        index === 1 ? { ...entry, content: "Changed approved spec\n" } : entry,
      ),
      agentContract,
      skills,
      diagnostic: {
        code: "execution.context_stale",
        path: "$.manifest[1].identity",
        message:
          "Required Context Manifest content no longer matches its identity.",
        remediation: "Refresh and approve the phase Manifest before dispatch.",
      },
    },
    {
      currentContext,
      agentContract: {
        ...agentContract,
        tools: [...agentContract.tools, "write"],
      },
      skills,
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.dispatch.agentContractIdentity",
        message:
          "Effective Phase Agent contract does not match the dispatched identity.",
        remediation:
          "Regenerate the Agent definition or dispatch its accepted Capability Contract.",
      },
    },
    {
      currentContext,
      agentContract,
      skills: skills.map((skill, index) =>
        index === 0
          ? {
              ...skill,
              identity: {
                algorithm: "sha256-lf-v1" as const,
                digest:
                  "935bbbf4747eba3afe5315a3c731f68d25835200e7d35e5fbc2d7d23a05a1b5e",
              },
              content: "changed implement skill\n",
            }
          : skill,
      ),
      diagnostic: {
        code: "execution.skill_invalid",
        path: "$.binding.skillIdentities",
        message:
          "Effective Skill identities no longer match the Phase execution binding.",
        remediation:
          "Restore the bound Skill revisions before requesting a capability.",
      },
    },
  ] as const;

  for (const staleCase of cases) {
    assert.deepEqual(
      coreContract.authorizePhaseExecution({
        contractVersion: 1,
        binding: bound.binding,
        manifest,
        currentContext: staleCase.currentContext,
        agentContract: staleCase.agentContract,
        skills: staleCase.skills,
        capability: { kind: "tool", name: "edit" },
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [staleCase.diagnostic],
      },
    );
  }
});

test("Core rejects malformed Manifest hashes and Agent capability enums", () => {
  const malformedHashManifest = manifest.map((entry, index) =>
    index === 1
      ? {
          ...entry,
          identity: {
            algorithm: "sha256-lf-v1" as const,
            digest: "not-a-sha256",
          },
        }
      : entry,
  );
  assert.deepEqual(
    coreContract.bindPhaseExecution({
      contractVersion: 1,
      dispatch: {
        ...dispatch,
        contextManifestIdentity:
          "sha256:d9e1995ece6efc6b3c940222c079ed2afe50552db4f704c3ec79333587eedf59",
      },
      manifest: malformedHashManifest,
      currentContext,
      agentContract,
      skills,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.context_invalid",
          path: "$.manifest[1].identity",
          message: "Context Manifest entry content identity is invalid.",
          remediation:
            "Use a supported SHA-256 content identity with a 64-character hexadecimal digest.",
        },
      ],
    },
  );

  const invalidAgentContract = { ...agentContract, network: "all" };
  assert.deepEqual(
    coreContract.bindPhaseExecution({
      contractVersion: 1,
      dispatch: {
        ...dispatch,
        agentContractIdentity:
          "sha256:d1ad5bae1c788810cc51ff4370dcf911baa4ce707832b569de972c1a30ce0733",
      },
      manifest,
      currentContext,
      agentContract: invalidAgentContract as unknown as typeof agentContract,
      skills,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.agent_invalid",
          path: "$.agentContract.network",
          message:
            "Phase Agent Capability Contract has unsupported network access.",
          remediation: "Use none or configured network access.",
        },
      ],
    },
  );
});

test("Core rejects invalid Manifest entry and Agent contract fields", () => {
  const manifestCases = [
    {
      manifest: manifest.map((entry, index) =>
        index === 0 ? { ...entry, schemaVersion: 2 } : entry,
      ),
      identity:
        "sha256:c451b596ba2d81067654db7ba59e233144b509a23d811f08450b5721eb33b08c",
      diagnostic: {
        code: "execution.context_invalid",
        path: "$.manifest[0].schemaVersion",
        message: "Context Manifest entry schema version is unsupported.",
        remediation: "Regenerate the Manifest with entry schemaVersion 1.",
      },
    },
    {
      manifest: manifest.map((entry, index) =>
        index === 0 ? { ...entry, mode: "raw" } : entry,
      ),
      identity:
        "sha256:2346ad9d40b65c32eeb70c72b74ec219bc656124166eebcad1997c59cfcf7957",
      diagnostic: {
        code: "execution.context_invalid",
        path: "$.manifest[0].mode",
        message: "Context Manifest entry has an unsupported injection mode.",
        remediation: "Use full, summary, or pointer.",
      },
    },
    {
      manifest: manifest.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              source: { ...entry.source, value: "../AGENTS.md" },
            }
          : entry,
      ),
      identity:
        "sha256:93d4dc2fa46948a6cef560d28a9f378a3d9bf746bc2549565fb735049325feab",
      diagnostic: {
        code: "execution.context_invalid",
        path: "$.manifest[0].source.value",
        message: "Project-path Context source must stay inside the repository.",
        remediation:
          "Use a normalized repository-relative path without dot segments.",
      },
    },
  ] as const;

  for (const invalidCase of manifestCases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch: {
          ...dispatch,
          contextManifestIdentity: invalidCase.identity,
        },
        manifest: invalidCase.manifest as unknown as typeof manifest,
        currentContext,
        agentContract,
        skills,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [invalidCase.diagnostic],
      },
    );
  }

  const agentCases = [
    {
      agentContract: { ...agentContract, repositoryAccess: "write-all" },
      identity:
        "sha256:7069bd487467c921757c0885b19ca7b2d4a54943a8ac87509953f53272b4db01",
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.agentContract.repositoryAccess",
        message:
          "Phase Agent Capability Contract has unsupported repository access.",
        remediation:
          "Use read-only, exclusive-write, or read-only-plus-exclusive-validation.",
      },
    },
    {
      agentContract: { ...agentContract, overridePolicy: "frontmatter" },
      identity:
        "sha256:8165d63adb4989699f3834ea41a7dca787f2c0d7c8f8c9b58695d3cf798ba033",
      diagnostic: {
        code: "execution.agent_invalid",
        path: "$.agentContract.overridePolicy",
        message: "Phase Agent Capability Contract has an unsafe override policy.",
        remediation: "Use prompt-body-only overrides.",
      },
    },
  ] as const;

  for (const invalidCase of agentCases) {
    assert.deepEqual(
      coreContract.bindPhaseExecution({
        contractVersion: 1,
        dispatch: {
          ...dispatch,
          agentContractIdentity: invalidCase.identity,
        },
        manifest,
        currentContext,
        agentContract:
          invalidCase.agentContract as unknown as typeof agentContract,
        skills,
      }),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [invalidCase.diagnostic],
      },
    );
  }
});

test("Core fails closed for an unknown runtime capability kind", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  assert.deepEqual(
    coreContract.authorizePhaseExecution({
      contractVersion: 1,
      binding: bound.binding,
      manifest,
      currentContext,
      agentContract,
      skills,
      capability: { kind: "admin" } as never,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.request_invalid",
          path: "$.capability.kind",
          message: "Phase capability kind is unsupported.",
          remediation:
            "Request a tool, network, spawn, repository, or Skill capability.",
        },
      ],
    },
  );
});

test("Core returns a structured failure for a malformed binding request", () => {
  for (const request of [null, undefined, 42, "invalid"]) {
    assert.deepEqual(coreContract.bindPhaseExecution(request as never), {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.request_invalid",
          path: "$",
          message: "Phase execution binding request must be a readable object.",
          remediation:
            "Provide contractVersion, dispatch, Manifest, current Context, Agent contract, and Skill materials.",
        },
      ],
    });
  }
});

test("Core returns structured failures for malformed authorization inputs", () => {
  const bound = coreContract.bindPhaseExecution({
    contractVersion: 1,
    dispatch,
    manifest,
    currentContext,
    agentContract,
    skills,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) {
    assert.fail("Expected the fixture to produce a Phase execution binding.");
  }

  const validRequest = {
    contractVersion: 1,
    binding: bound.binding,
    manifest,
    currentContext,
    agentContract,
    skills,
    capability: { kind: "tool", name: "edit" },
  } as const;
  const cases = [
    {
      request: null,
      diagnostic: {
        code: "execution.request_invalid",
        path: "$",
        message:
          "Phase execution authorization request must be a readable object.",
        remediation:
          "Provide contractVersion, binding, current execution materials, and one capability.",
      },
    },
    {
      request: { ...validRequest, binding: null },
      diagnostic: {
        code: "execution.request_invalid",
        path: "$.binding",
        message:
          "Phase execution authorization binding must be a readable object.",
        remediation: "Use a binding returned by bindPhaseExecution.",
      },
    },
    {
      request: { ...validRequest, capability: null },
      diagnostic: {
        code: "execution.request_invalid",
        path: "$.capability",
        message: "Phase execution capability must be a readable object.",
        remediation:
          "Request a tool, network, spawn, repository, or Skill capability.",
      },
    },
  ] as const;

  for (const authorizationCase of cases) {
    assert.deepEqual(
      coreContract.authorizePhaseExecution(authorizationCase.request as never),
      {
        ok: false,
        contractVersion: 1,
        diagnostics: [authorizationCase.diagnostic],
      },
    );
  }
});

test("Core fails closed when binding input cannot be read safely", () => {
  const cyclicManifest: unknown[] = [];
  cyclicManifest.push(cyclicManifest);

  assert.deepEqual(
    coreContract.bindPhaseExecution({
      contractVersion: 1,
      dispatch,
      manifest: cyclicManifest as never,
      currentContext,
      agentContract,
      skills,
    }),
    {
      ok: false,
      contractVersion: 1,
      diagnostics: [
        {
          code: "execution.request_invalid",
          path: "$",
          message: "Phase execution binding request could not be read safely.",
          remediation:
            "Provide plain contract data without accessors, cycles, or unreadable values.",
        },
      ],
    },
  );
});
