import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { coreContract, type SkillBundle } from "@dnslin/sayhi-core";

import { TEST_SKILL_BUNDLE } from "./skill-bundle-test-support.js";

const IMPLEMENTATION_CAPABILITY = {
  agentRole: "implementation",
  agentContractIdentity: `sha256:${"c".repeat(64)}`,
  skillName: "implement",
} as const;

const PLANNING_CAPABILITY = {
  agentRole: "planning",
  agentContractIdentity: `sha256:${"d".repeat(64)}`,
  skillName: "tdd",
} as const;

const UPGRADED_IMPLEMENT_CONTENT = [
  "---",
  "name: implement",
  "disable-model-invocation: false",
  "---",
  "Use tdd for focused contract tests.",
  "",
].join("\n");

const ACTIVE_TASK = Object.freeze({
  projection: Object.freeze({ id: "TASK-38-ACTIVE", version: 4, phase: "implement" }),
  events: Object.freeze([
    Object.freeze({ sequence: 1, kind: "phaseStarted", taskId: "TASK-38-ACTIVE" }),
  ]),
});

test("Core proposes compatible Skill changes with provenance, integrity, and affected capabilities", () => {
  const locked = TEST_SKILL_BUNDLE;
  const available = availableBundle();

  const result = coreContract.proposeSkillUpgrades({
    lockedBundle: locked,
    availableBundle: available,
    capabilities: [IMPLEMENTATION_CAPABILITY, PLANNING_CAPABILITY],
    sidecarConstraints: [],
    tests: [
      {
        skillName: "implement",
        path: "packages/testing/src/skill-upgrade.contract.test.ts",
      },
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.proposal.compatibility.compatible, true);
  assert.deepEqual(result.proposal.locked.registry, locked.lock.registry);
  assert.deepEqual(result.proposal.available.registry, available.lock.registry);
  assert.match(result.proposal.locked.identity, /^sha256:[0-9a-f]{64}$/u);
  assert.match(result.proposal.available.identity, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(result.proposal.affectedCapabilities, [IMPLEMENTATION_CAPABILITY]);
  assert.deepEqual(result.proposal.affectedTests, [
    {
      skillName: "implement",
      path: "packages/testing/src/skill-upgrade.contract.test.ts",
    },
  ]);
  assert.deepEqual(result.proposal.requiredSayHiVersion, {
    kind: "new-release",
    reason: "Skill Lock identity changed.",
  });
  const implementChange = result.proposal.changes[0]!;
  assert.deepEqual(implementChange.licenseNotice, {
    before: "MIT",
    after: "MIT",
    changed: false,
    noticeReviewRequired: false,
    noticeChanged: false,
  });
  assert.deepEqual(implementChange.semantic, {
    frontmatter: { before: null, after: "name: implement\ndisable-model-invocation: false", changed: true },
    invocation: {
      before: [],
      after: ["disable-model-invocation: false", "name: implement"],
      changed: true,
    },
    crossSkillReferences: { added: ["tdd"], removed: [] },
  });
  assert.deepEqual(
    result.proposal.changes.map((change) => ({
      kind: change.kind,
      name: change.name,
      before: change.before?.upstream.commit,
      after: change.after?.upstream.commit,
      files: change.files.map((file) => ({
        kind: file.kind,
        path: file.path,
        before: file.before?.digest,
        after: file.after?.digest,
      })),
    })),
    [
      {
        kind: "changed",
        name: "implement",
        before: "1".repeat(40),
        after: "4".repeat(40),
        files: [
          {
            kind: "changed",
            path: "SKILL.md",
            before: "918901d60ffbd690430096b5aa9e9b1c68ad82e8f5287e58dea1924002cf8543",
            after: hashSkill(UPGRADED_IMPLEMENT_CONTENT).digest,
          },
        ],
      },
    ],
  );
  assert.deepEqual(implementChange.files[0]?.text, {
    before: "implement skill\n",
    after: UPGRADED_IMPLEMENT_CONTENT,
  });
  assert.equal(Object.isFrozen(result.proposal), true);
  assert.equal(Object.isFrozen(result.proposal.changes), true);
  assert.equal(Object.isFrozen(result.proposal.changes[0]!), true);
});

test("Core reports renamed Skill files with normalized text and identities", () => {
  const guideContent = "Guide\r\n";
  const lockedBundle = {
    lock: {
      ...TEST_SKILL_BUNDLE.lock,
      skills: TEST_SKILL_BUNDLE.lock.skills.map((skill) =>
        skill.name === "implement"
          ? {
              ...skill,
              files: [...skill.files, { path: "GUIDE.md", sha256: hashSkill(guideContent) }],
            }
          : skill,
      ),
    },
    files: [...TEST_SKILL_BUNDLE.files, { path: "implement/GUIDE.md", content: guideContent }],
  };
  const implementationSkill = lockedBundle.lock.skills.find(
    (skill) => skill.name === "implement",
  );
  if (implementationSkill === undefined) {
    assert.fail("Expected the fixture to include the implement Skill.");
  }
  const renamedImplementationFiles = implementationSkill.files.map((file) =>
    file.path === "GUIDE.md" ? { ...file, path: "GUIDE-RENAMED.md" } : file,
  );
  const availableBundle = {
    lock: {
      ...lockedBundle.lock,
      registry: { ...lockedBundle.lock.registry, commit: "6".repeat(40) },
      skills: lockedBundle.lock.skills.map((skill) =>
        skill.name === "implement"
          ? { ...skill, files: renamedImplementationFiles }
          : skill,
      ),
    },
    files: lockedBundle.files.map((file) =>
      file.path === "implement/GUIDE.md"
        ? { ...file, path: "implement/GUIDE-RENAMED.md" }
        : file,
    ),
  };

  const result = coreContract.proposeSkillUpgrades({
    lockedBundle,
    availableBundle,
    capabilities: [IMPLEMENTATION_CAPABILITY],
    sidecarConstraints: [],
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const renamed = result.proposal.changes[0]?.files.find((file) => file.kind === "renamed");
  assert.deepEqual(renamed, {
    kind: "renamed",
    path: "GUIDE-RENAMED.md",
    previousPath: "GUIDE.md",
    before: hashSkill(guideContent),
    after: hashSkill(guideContent),
    text: { before: "Guide\n", after: "Guide\n" },
  });
});

test("Core reports license inventory review and rejects unknown affected-test Skills", () => {
  const base = availableBundle();
  const candidateBundle = {
    ...base,
    lock: {
      ...base.lock,
      skills: base.lock.skills.map((skill) =>
        skill.name === "implement"
          ? { ...skill, upstream: { ...skill.upstream, license: "Apache-2.0" } }
          : skill,
      ),
    },
  };
  const result = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: candidateBundle,
    capabilities: [IMPLEMENTATION_CAPABILITY],
    tests: [
      {
        skillName: "implement",
        path: "packages/testing/src/skill-upgrade.contract.test.ts",
      },
    ],
    sidecarConstraints: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.proposal.changes[0]?.licenseNotice, {
      before: "MIT",
      after: "Apache-2.0",
      changed: true,
      noticeReviewRequired: true,
      noticeChanged: false,
    });
  }

  const invalid = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: base,
    capabilities: [IMPLEMENTATION_CAPABILITY],
    tests: [{ skillName: "unlocked", path: "packages/testing/src/unknown.test.ts" }],
    sidecarConstraints: [],
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.diagnostics[0]?.code, "skill_upgrade.test_invalid");
  }
});

test("Core keeps byte-identity files textless and flags changed notices", () => {
  const noticeBefore = "Notice one\n";
  const noticeAfter = "Notice two\n";
  const bytesBefore = "bytes\r\n";
  const bytesAfter = "bytes changed\r\n";
  const bytesBeforeHash = {
    algorithm: "sha256-bytes-v1" as const,
    digest: createHash("sha256").update(bytesBefore, "utf8").digest("hex"),
  };
  const bytesAfterHash = {
    algorithm: "sha256-bytes-v1" as const,
    digest: createHash("sha256").update(bytesAfter, "utf8").digest("hex"),
  };
  const lockedBundle = {
    lock: {
      ...TEST_SKILL_BUNDLE.lock,
      skills: TEST_SKILL_BUNDLE.lock.skills.map((skill) =>
        skill.name === "implement"
          ? {
              ...skill,
              files: [
                ...skill.files,
                { path: "NOTICE.md", sha256: hashSkill(noticeBefore) },
                { path: "payload.bin", sha256: bytesBeforeHash },
              ],
            }
          : skill,
      ),
    },
    files: [
      ...TEST_SKILL_BUNDLE.files,
      { path: "implement/NOTICE.md", content: noticeBefore },
      { path: "implement/payload.bin", content: bytesBefore },
    ],
  };
  const implementationSkill = lockedBundle.lock.skills.find(
    (skill) => skill.name === "implement",
  );
  if (implementationSkill === undefined) {
    assert.fail("Expected the fixture to include the implement Skill.");
  }
  const availableImplementationFiles = implementationSkill.files.map((file) => {
    if (file.path === "NOTICE.md") {
      return { ...file, sha256: hashSkill(noticeAfter) };
    }
    if (file.path === "payload.bin") {
      return { ...file, sha256: bytesAfterHash };
    }
    return file;
  });
  const availableBundle = {
    lock: {
      ...lockedBundle.lock,
      registry: { ...lockedBundle.lock.registry, commit: "7".repeat(40) },
      skills: lockedBundle.lock.skills.map((skill) =>
        skill.name === "implement"
          ? { ...skill, files: availableImplementationFiles }
          : skill,
      ),
    },
    files: lockedBundle.files.map((file) => {
      if (file.path === "implement/NOTICE.md") {
        return { ...file, content: noticeAfter };
      }
      if (file.path === "implement/payload.bin") {
        return { ...file, content: bytesAfter };
      }
      return file;
    }),
  };

  const result = coreContract.proposeSkillUpgrades({
    lockedBundle,
    availableBundle,
    capabilities: [IMPLEMENTATION_CAPABILITY],
    sidecarConstraints: [],
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const change = result.proposal.changes[0]!;
  assert.deepEqual(change.licenseNotice, {
    before: "MIT",
    after: "MIT",
    changed: false,
    noticeChanged: true,
    noticeReviewRequired: true,
  });
  assert.deepEqual(
    change.files.find((file) => file.path === "payload.bin")?.text,
    { before: null, after: null },
  );
});

test("Core reports frontmatter and invocation when the closing marker reaches EOF", () => {
  const skillContent = "---\nname: implement\n---";
  const base = availableBundle();
  const candidateBundle = {
    ...base,
    lock: {
      ...base.lock,
      skills: base.lock.skills.map((skill) =>
        skill.name === "implement"
          ? { ...skill, files: [{ path: "SKILL.md", sha256: hashSkill(skillContent) }] }
          : skill,
      ),
    },
    files: base.files.map((file) =>
      file.path === "implement/SKILL.md"
        ? { ...file, content: new TextEncoder().encode(skillContent) }
        : file,
    ),
  };

  const result = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: candidateBundle,
    capabilities: [IMPLEMENTATION_CAPABILITY],
    sidecarConstraints: [],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.proposal.changes[0]?.semantic.frontmatter, {
      before: null,
      after: "name: implement",
      changed: true,
    });
    assert.deepEqual(result.proposal.changes[0]?.semantic.invocation, {
      before: [],
      after: ["name: implement"],
      changed: true,
    });
  }
});

test("Core reports incompatible Registry sources, removed Skills, and unapproved sidecars", () => {
  const base = availableBundle();
  const cases = [
    {
      name: "Registry source changed",
      availableBundle: {
        ...base,
        lock: {
          ...base.lock,
          registry: { ...base.lock.registry, repository: "https://example.test/skills" },
        },
      },
      code: "skill_upgrade.registry_repository_changed",
    },
    {
      name: "locked Skill removed",
      availableBundle: {
        lock: { ...base.lock, skills: base.lock.skills.slice(0, 1) },
        files: base.files.slice(0, 1),
      },
      code: "skill_upgrade.locked_skill_removed",
    },
    {
      name: "sidecar changed without allowance",
      availableBundle: {
        ...base,
        lock: {
          ...base.lock,
          skills: base.lock.skills.map((skill) =>
            skill.name === "implement"
              ? { ...skill, sidecarIdentity: `sha256:${"f".repeat(64)}` }
              : skill,
          ),
        },
      },
      code: "skill_upgrade.sidecar_incompatible",
    },
  ] as const satisfies readonly {
    readonly name: string;
    readonly availableBundle: SkillBundle;
    readonly code: string;
  }[];

  for (const invalidCase of cases) {
    const result = coreContract.proposeSkillUpgrades({
      lockedBundle: TEST_SKILL_BUNDLE,
      availableBundle: invalidCase.availableBundle,
      capabilities: [IMPLEMENTATION_CAPABILITY, PLANNING_CAPABILITY],
      sidecarConstraints: [],
    });

    assert.equal(result.ok, true, invalidCase.name);
    if (!result.ok) {
      continue;
    }
    assert.equal(result.proposal.compatibility.compatible, false, invalidCase.name);
    assert.deepEqual(
      result.proposal.compatibility.failures.map((failure) => failure.code),
      [invalidCase.code],
      invalidCase.name,
    );
  }
});

test("Core accepts an explicitly compatible replacement sidecar", () => {
  const replacementIdentity = `sha256:${"f".repeat(64)}`;
  const base = availableBundle();
  const candidateBundle = {
    ...base,
    lock: {
      ...base.lock,
      skills: base.lock.skills.map((skill) =>
        skill.name === "implement"
          ? { ...skill, sidecarIdentity: replacementIdentity }
          : skill,
      ),
    },
  };

  const result = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: candidateBundle,
    capabilities: [IMPLEMENTATION_CAPABILITY, PLANNING_CAPABILITY],
    sidecarConstraints: [
      {
        skillName: "implement",
        compatibleSidecarIdentities: [replacementIdentity],
      },
    ],
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.proposal.compatibility, { compatible: true, failures: [] });
  }
});

test("Core rejects malformed Skill upgrade proposal input", () => {
  const result = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: availableBundle(),
    capabilities: [{ ...IMPLEMENTATION_CAPABILITY, skillName: "unlocked" }],
    sidecarConstraints: [],
  });

  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "skill_upgrade.capability_invalid",
        path: "$.capabilities[0].skillName",
        message: "Skill upgrade capability must name a Skill in the locked bundle.",
        remediation: "Declare only Phase Agent Skill capabilities selected by the locked release.",
      },
    ],
  });

  const unsupportedRole = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: availableBundle(),
    capabilities: [{ ...IMPLEMENTATION_CAPABILITY, agentRole: "unmanaged" }],
    sidecarConstraints: [],
  });
  assert.equal(unsupportedRole.ok, false);
  if (!unsupportedRole.ok) {
    assert.equal(unsupportedRole.diagnostics[0]?.code, "skill_upgrade.capability_invalid");
  }
});

test("Discarding a proposal preserves release and active Task hashes", () => {
  const release = {
    artifacts: { skillBundle: TEST_SKILL_BUNDLE, integrity: `sha256:${"e".repeat(64)}` },
  };
  const beforeRelease = canonicalHash(release);
  const beforeTask = canonicalHash(ACTIVE_TASK);

  const proposal = coreContract.proposeSkillUpgrades({
    lockedBundle: TEST_SKILL_BUNDLE,
    availableBundle: availableBundle(),
    capabilities: [IMPLEMENTATION_CAPABILITY, PLANNING_CAPABILITY],
    sidecarConstraints: [],
  });
  void proposal;

  assert.equal(canonicalHash(release), beforeRelease);
  assert.equal(canonicalHash(ACTIVE_TASK), beforeTask);
});

function availableBundle() {
  const upgradedContent = UPGRADED_IMPLEMENT_CONTENT;
  return {
    lock: {
      ...TEST_SKILL_BUNDLE.lock,
      registry: { ...TEST_SKILL_BUNDLE.lock.registry, commit: "5".repeat(40) },
      skills: TEST_SKILL_BUNDLE.lock.skills.map((skill) =>
        skill.name === "implement"
          ? {
              ...skill,
              files: [{ path: "SKILL.md", sha256: hashSkill(upgradedContent) }],
              upstream: { ...skill.upstream, commit: "4".repeat(40) },
            }
          : skill,
      ),
    },
    files: TEST_SKILL_BUNDLE.files.map((file) =>
      file.path === "implement/SKILL.md" ? { ...file, content: upgradedContent } : file,
    ),
  };
}

function hashSkill(content: string) {
  return {
    algorithm: "sha256-lf-v1" as const,
    digest: createHash("sha256")
      .update(content.replace(/\r\n?/gu, "\n"), "utf8")
      .digest("hex"),
  };
}

function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
