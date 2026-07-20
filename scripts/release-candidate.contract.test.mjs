import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import {
  createReleaseEvidence,
  verifyReleaseCandidateDirectory,
  verifyNpmToolchain,
  verifyNodeToolchain,
  verifyReleaseEvidence,
} from "./release-candidate.mjs";

const SHA256_A = `sha256:${"a".repeat(64)}`;
const SHA256_B = `sha256:${"b".repeat(64)}`;
const SHA512_A = `sha512-${"A".repeat(86)}==`;

test("release candidate requires the declared npm toolchain", () => {
  assert.equal(verifyNpmToolchain("npm@10.9.2", "10.9.2"), "10.9.2");
  assert.throws(
    () => verifyNpmToolchain("npm@10.9.2", "11.0.0"),
    /requires npm 10\.9\.2/u,
  );
});

test("release candidate requires the declared Node toolchain", () => {
  assert.equal(verifyNodeToolchain(">=22.17.0", "v24.14.0"), "v24.14.0");
  assert.throws(
    () => verifyNodeToolchain(">=22.17.0", "v22.16.9"),
    /requires Node >=22\.17\.0/u,
  );
});

function buildReleaseEvidenceFixture(archiveSha256 = SHA256_A) {
  return {
    source: {
      repository: "https://github.com/dnslin/SayHi",
      revision: `git:${"1".repeat(40)}`,
    },
    dependencies: {
      packageLockSha256: SHA256_B,
      node: "v22.17.0",
      npm: "10.9.2",
    },
    release: {
      integrity: SHA256_A,
      skillBundle: {
        lockIdentity: SHA256_B,
        lock: { schemaVersion: 1, registry: { repository: "https://github.com/dnslin/skills", commit: "2".repeat(40) }, skills: [] },
        files: [],
      },
      compatibility: {
        recordContract: 1,
        managedProjectContract: 1,
        projectSchema: 1,
        templates: "0.1.0",
        skillBundleContract: 1,
        skillLockDigest: SHA256_B,
      },
    },
    artifacts: ["core", "cli", "omp"].map((name) => ({
      name,
      packageName: `@dnslin/sayhi-${name === "omp" ? "omp" : name}`,
      file: `dnslin-sayhi-${name}-0.0.0.tgz`,
      sha256: archiveSha256,
      npmIntegrity: SHA512_A,
      packageManifestSha256: SHA256_B,
      inventory: [
        { path: "LICENSE", size: 1096, mode: 420 },
        { path: "package.json", size: 400, mode: 420 },
      ],
    })),
  };
}

const exitGates = [0, 1, 2, 3, 4, 5].map((milestone) => ({
  milestone,
  command: "installed V1 contract matrix",
  status: "passed",
}));

const installedAcceptance = {
  command: "node --test installed @sayhi/testing contract matrix",
  contractFiles: [
    "context-cli.contract.test.js",
    "context-manifest.contract.test.js",
    "execution.contract.test.js",
    "initiative-scheduler.contract.test.js",
    "managed-project-bin.contract.test.js",
    "managed-project-cli.contract.test.js",
    "omp.contract.test.js",
    "spec-context-cli.contract.test.js",
    "task-lifecycle-filesystem.contract.test.js",
    "task-lifecycle.contract.test.js",
    "workflow.contract.test.js",
  ],
  status: "passed",
};

test("release evidence binds matching locked builds to all V1 gates", () => {
  const evidence = createReleaseEvidence(
    buildReleaseEvidenceFixture(),
    buildReleaseEvidenceFixture(),
    exitGates,
    installedAcceptance,
  );

  assert.deepEqual(evidence.source, buildReleaseEvidenceFixture().source);
  assert.equal(evidence.artifacts.length, 3);
  assert.deepEqual(evidence.exitGates, exitGates);
  assert.deepEqual(evidence.installedAcceptance, installedAcceptance);
  assert.doesNotThrow(() => verifyReleaseEvidence(evidence));
});

test("release evidence rejects an altered installed contract matrix", () => {
  const evidence = createReleaseEvidence(
    buildReleaseEvidenceFixture(),
    buildReleaseEvidenceFixture(),
    exitGates,
    installedAcceptance,
  );
  assert.throws(
    () =>
      verifyReleaseEvidence({
        ...evidence,
        installedAcceptance: {
          ...evidence.installedAcceptance,
          contractFiles: evidence.installedAcceptance.contractFiles.slice(0, -1),
        },
      }),
    /V1 matrix/u,
  );
});

test("release evidence rejects a changed retained archive", () => {
  assert.throws(
    () =>
      createReleaseEvidence(
        buildReleaseEvidenceFixture(),
        buildReleaseEvidenceFixture(SHA256_B),
        exitGates,
        installedAcceptance,
      ),
    /differ/u,
  );
});

test("release evidence rejects incomplete Milestone Gate coverage", () => {
  assert.throws(
    () =>
      createReleaseEvidence(
        buildReleaseEvidenceFixture(),
        buildReleaseEvidenceFixture(),
        exitGates.slice(0, -1),
        installedAcceptance,
      ),
    /Milestone 5/u,
  );
});

test("release evidence verification rejects tampered artifact identities", () => {
  const evidence = createReleaseEvidence(
    buildReleaseEvidenceFixture(),
    buildReleaseEvidenceFixture(),
    exitGates,
    installedAcceptance,
  );
  const tampered = {
    ...evidence,
    artifacts: evidence.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, sha256: "sha256:invalid" } : artifact,
    ),
  };

  assert.throws(() => verifyReleaseEvidence(tampered), /SHA-256/u);
});

test("release candidate verification rejects unlisted archives", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "sayhi-release-evidence-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const evidence = createReleaseEvidence(
    buildReleaseEvidenceFixture(),
    buildReleaseEvidenceFixture(),
    exitGates,
    installedAcceptance,
  );
  await mkdir(join(output, "artifacts"));
  await writeFile(join(output, "release-evidence.json"), JSON.stringify(evidence), "utf8");
  await writeFile(join(output, "artifacts", "unexpected.tgz"), "unexpected", "utf8");

  await assert.rejects(
    () => verifyReleaseCandidateDirectory(output),
    /unexpected/u,
  );
});

test("release candidate verification rehashes packed package manifests", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "sayhi-release-evidence-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const candidate = packedCandidateBuild();
  const evidence = evidenceForPackedBuild({
    ...candidate.build,
    artifacts: candidate.build.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, packageManifestSha256: SHA256_B } : artifact,
    ),
  });
  await writeReleaseCandidateFixture(output, evidence, candidate.archives);

  await assert.rejects(
    () => verifyReleaseCandidateDirectory(output),
    /package manifest SHA-256 differs/u,
  );
});

test("release candidate verification rehashes packed inventories", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "sayhi-release-evidence-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const candidate = packedCandidateBuild();
  const evidence = evidenceForPackedBuild({
    ...candidate.build,
    artifacts: candidate.build.artifacts.map((artifact, index) =>
      index === 0
        ? {
            ...artifact,
            inventory: [{ ...artifact.inventory[0], size: artifact.inventory[0].size + 1 }],
          }
        : artifact,
    ),
  });
  await writeReleaseCandidateFixture(output, evidence, candidate.archives);

  await assert.rejects(
    () => verifyReleaseCandidateDirectory(output),
    /inventory differs/u,
  );
});

test("release candidate verification recomputes npm integrity", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "sayhi-release-evidence-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const candidate = packedCandidateBuild();
  const evidence = evidenceForPackedBuild({
    ...candidate.build,
    artifacts: candidate.build.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, npmIntegrity: SHA512_A } : artifact,
    ),
  });
  await writeReleaseCandidateFixture(output, evidence, candidate.archives);

  await assert.rejects(
    () => verifyReleaseCandidateDirectory(output),
    /npm integrity differs/u,
  );
});

test("release candidate verification rejects unsafe non-regular package entries", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "sayhi-release-evidence-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const candidate = packedCandidateBuild(true);
  const evidence = evidenceForPackedBuild(candidate.build);
  await writeReleaseCandidateFixture(output, evidence, candidate.archives);

  await assert.rejects(
    () => verifyReleaseCandidateDirectory(output),
    /unsafe package entry path/u,
  );
});

function packedCandidateBuild(includeUnsafeDirectory = false) {
  const build = buildReleaseEvidenceFixture();
  const archives = new Map();
  return {
    archives,
    build: {
      ...build,
      artifacts: build.artifacts.map((artifact) => {
        const packed = archiveWithPackageManifest(
          { name: artifact.packageName },
          includeUnsafeDirectory,
        );
        archives.set(artifact.file, packed.archive);
        return {
          ...artifact,
          sha256: sha256(packed.archive),
          npmIntegrity: packed.npmIntegrity,
          packageManifestSha256: packed.packageManifestSha256,
          inventory: packed.inventory,
        };
      }),
    },
  };
}

function evidenceForPackedBuild(build) {
  return createReleaseEvidence(build, build, exitGates, installedAcceptance);
}

async function writeReleaseCandidateFixture(output, evidence, archives) {
  await mkdir(join(output, "artifacts"));
  await writeFile(join(output, "release-evidence.json"), JSON.stringify(evidence), "utf8");
  await Promise.all(
    [...archives].map(([file, archive]) =>
      writeFile(join(output, "artifacts", file), archive),
    ),
  );
}

function archiveWithPackageManifest(packageManifest, includeUnsafeDirectory) {
  const content = Buffer.from(JSON.stringify(packageManifest), "utf8");
  const header = Buffer.alloc(512);
  header.write("package/package.json");
  header.write("0000644\0", 100);
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  const unsafeDirectory = Buffer.alloc(512);
  unsafeDirectory.write("package/../escape");
  unsafeDirectory.write("0000755\0", 100);
  unsafeDirectory.write("00000000000\0", 124);
  unsafeDirectory[156] = "5".charCodeAt(0);
  const archive = gzipSync(
    Buffer.concat([
      header,
      content,
      padding,
      ...(includeUnsafeDirectory ? [unsafeDirectory] : []),
      Buffer.alloc(1024),
    ]),
  );
  return {
    archive,
    inventory: [{ path: "package.json", size: content.length, mode: 420 }],
    npmIntegrity: npmIntegrity(archive),
    packageManifestSha256: sha256(content),
  };
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function npmIntegrity(content) {
  return `sha512-${createHash("sha512").update(content).digest("base64")}`;
}
