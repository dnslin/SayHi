import assert from "node:assert/strict";
import test from "node:test";

import {
  coreContract,
  type InstalledProjectVersions,
  type SkillBundle,
} from "@dnslin/sayhi-core";

const skillBundle = {
  lock: {
    schemaVersion: 1,
    registry: {
      repository: "https://github.com/dnslin/skills",
      commit: "1".repeat(40),
    },
    skills: [
      {
        name: "implement",
        path: "implement",
        files: [
          {
            path: "SKILL.md",
            sha256: {
              algorithm: "sha256-lf-v1",
              digest:
                "918901d60ffbd690430096b5aa9e9b1c68ad82e8f5287e58dea1924002cf8543",
            },
          },
        ],
        upstream: {
          repository: "https://github.com/mattpocock/skills",
          commit: "2".repeat(40),
          path: "skills/engineering/implement",
          license: "MIT",
        },
        sidecarIdentity: `sha256:${"a".repeat(64)}`,
      },
      {
        name: "tdd",
        path: "tdd",
        files: [
          {
            path: "SKILL.md",
            sha256: {
              algorithm: "sha256-lf-v1",
              digest:
                "ddf8a3f4287831a447c0b4e2c506026a849b77036f67c659275025d130f5040d",
            },
          },
        ],
        upstream: {
          repository: "https://github.com/mattpocock/skills",
          commit: "3".repeat(40),
          path: "skills/engineering/tdd",
          license: "MIT",
        },
        sidecarIdentity: `sha256:${"b".repeat(64)}`,
      },
    ],
  },
  files: [
    { path: "implement/SKILL.md", content: "implement skill\n" },
    { path: "tdd/SKILL.md", content: "tdd skill\n" },
  ],
} as const satisfies SkillBundle;

function installed(skillLockDigest: string): InstalledProjectVersions {
  return {
    core: "1.0.0",
    cli: "1.0.0",
    ompPlugin: "1.0.0",
    projectSchema: 1,
    templates: "1.0.0",
    skillLockDigest: skillLockDigest as `sha256:${string}`,
  };
}

test("Core verifies an unchanged exact Skill bundle and binds its installation identity", () => {
  const verified = coreContract.verifySkillBundle(skillBundle);

  assert.equal(verified.ok, true);
  if (!verified.ok) {
    return;
  }
  assert.match(verified.lockIdentity, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    verified.skills.map(({ name, skillFile }) => ({ name, path: skillFile.path })),
    [
      { name: "implement", path: "implement/SKILL.md" },
      { name: "tdd", path: "tdd/SKILL.md" },
    ],
  );

  assert.deepEqual(
    coreContract.verifySkillBundleInstallation({
      bundle: skillBundle,
      installation: installed(verified.lockIdentity),
    }),
    { ok: true, contractVersion: 1, lockIdentity: verified.lockIdentity },
  );
});

test("Core verifies sha256-lf Skill bytes serialized with CRLF", () => {
  const result = coreContract.verifySkillBundle({
    ...skillBundle,
    files: skillBundle.files.map((file) => ({
      ...file,
      content: file.content.replaceAll("\n", "\r\n"),
    })),
  });

  assert.equal(result.ok, true);
});

test("Core rejects missing, modified, renamed, and unexpected Skill bundle files", () => {
  const cases = [
    {
      name: "missing",
      bundle: { ...skillBundle, files: skillBundle.files.slice(1) },
      code: "skill_bundle.file_missing",
    },
    {
      name: "modified",
      bundle: {
        ...skillBundle,
        files: skillBundle.files.map((file) =>
          file.path === "implement/SKILL.md"
            ? { ...file, content: "modified implementation skill\n" }
            : file,
        ),
      },
      code: "skill_bundle.file_modified",
    },
    {
      name: "renamed",
      bundle: {
        ...skillBundle,
        files: skillBundle.files.map((file) =>
          file.path === "implement/SKILL.md"
            ? { ...file, path: "substituted/SKILL.md" }
            : file,
        ),
      },
      code: "skill_bundle.file_missing",
    },
    {
      name: "unexpected",
      bundle: {
        ...skillBundle,
        files: [...skillBundle.files, { path: "tdd/unreviewed.md", content: "extra\n" }],
      },
      code: "skill_bundle.file_unexpected",
    },
  ] as const;

  for (const invalidCase of cases) {
    const result = coreContract.verifySkillBundle(invalidCase.bundle);
    assert.equal(result.ok, false, invalidCase.name);
    if (!result.ok) {
      assert.equal(result.diagnostics[0]?.code, invalidCase.code, invalidCase.name);
    }
  }
});

test("Core rejects a bundle whose lock identity differs from the installed release", () => {
  const result = coreContract.verifySkillBundleInstallation({
    bundle: skillBundle,
    installation: installed(`sha256:${"f".repeat(64)}`),
  });

  assert.deepEqual(result, {
    ok: false,
    contractVersion: 1,
    diagnostics: [
      {
        code: "skill_bundle.installation_mismatch",
        path: "$.installation.skillLockDigest",
        message: "Installed Skill Lock identity does not match the verified release bundle.",
        remediation: "Install the release bundle that matches the Project Manifest or run an approved update.",
      },
    ],
  });
});
