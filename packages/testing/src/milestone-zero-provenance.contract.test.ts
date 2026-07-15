import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extname } from "node:path";
import test from "node:test";

import {
  collectTextSources,
  readRepositoryFile,
  REPOSITORY_ROOT,
} from "./repository-test-support.js";

const TRELLIS_PROVENANCE_REVISION = "e7c5ead4d0dfd717d11a40b6bc0c80d8af94c49a";
const TRELLIS_ARTIFACT_HASHES = new Set([
  "d3202d30daefa004db85e42adf110ec061b07e9609eb2135094be045ceb32576",
  "4e6b6468ea88f25e07a9334e7b2e6dc10f0fc6c35186aa51353be8da3f5b6841",
  "675391144226d66d42f7e808b8296b8633a0313e626a9c316a0292545fdeaea6",
  "c677357c1353142076aa4ba2773b8cdd7843d833c160efd53e6a57d0bb625d25",
  "8dce61cdce1b06939153f02b2b1624133e0258e081a390b118910a3c05c92532",
  "e759409d48ed8c7d1710186d8180a602bd81bfe1d7cb6713c780e761534648c9",
]);

test("AC-0004: full-tree provenance checks preserve the clean-room boundary", () => {
  const packageFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/omp-plugin/package.json",
    "packages/testing/package.json",
  ];
  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(readRepositoryFile(packageFile)) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    for (const dependencyName of dependencyNames) {
      assert.doesNotMatch(dependencyName, /(?:trellis|oh-my-pi)/iu, packageFile);
    }
  }

  const repositorySources = collectTextSources(REPOSITORY_ROOT);
  for (const sourceFile of repositorySources) {
    const sourceIdentity = normalizedTextIdentity(sourceFile.source);
    assert.ok(
      !TRELLIS_ARTIFACT_HASHES.has(sourceIdentity),
      `${sourceFile.path} duplicates a Trellis artifact from ${TRELLIS_PROVENANCE_REVISION}`,
    );
  }
  const codeExtensions = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
  for (const sourceFile of repositorySources) {
    if (!codeExtensions.has(extname(sourceFile.path))) {
      continue;
    }
    const imports = sourceFile.source.matchAll(
      /(?:\bfrom\s+|\bimport\s*\()\s*["']([^"']+)["']/gu,
    );
    for (const match of imports) {
      const specifier = match[1];
      assert.ok(specifier, sourceFile.path);
      assert.doesNotMatch(
        specifier,
        /(?:trellis|oh-my-pi)/iu,
        sourceFile.path,
      );
    }
  }

  const trellisAuditFiles = new Set([
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "CONTEXT.md",
    "docs/README.md",
    "docs/adr/0001-clean-room-omp-first.md",
    "docs/references.md",
    "docs/spec/acceptance.md",
    "docs/spec/design-tradeoffs.md",
    "docs/spec/product.md",
    "docs/spec/supply-chain.md",
    "packages/testing/src/milestone-zero-provenance.contract.test.ts",
  ]);
  for (const sourceFile of repositorySources) {
    const namesTrellis =
      sourceFile.path.toLowerCase().includes("trellis") ||
      /\bTrellis\b/u.test(sourceFile.source);
    if (namesTrellis) {
      assert.ok(trellisAuditFiles.has(sourceFile.path), sourceFile.path);
    }
  }

  const references = readRepositoryFile("docs/references.md");
  const attributedUrls = new Set(
    [...references.matchAll(/https:\/\/[^\s)<>\]`"']+/gu)].map((match) =>
      normalizeUrl(match[0]),
    ),
  );
  const referenceConsumers = repositorySources.filter(
    (source) =>
      (source.path === "README.md" || source.path.startsWith("docs/")) &&
      source.path !== "docs/references.md",
  );
  for (const source of referenceConsumers) {
    for (const match of source.source.matchAll(/https:\/\/[^\s)<>\]`"']+/gu)) {
      const url = normalizeUrl(match[0]);
      if (!isIllustrativeUrl(url)) {
        assert.ok(attributedUrls.has(url), `${source.path}: ${url}`);
      }
    }
  }

  const readme = readRepositoryFile("README.md");
  assert.match(readme, /## Clean-room boundary/u);
  assert.match(readme, /MUST NOT copy or adapt OMP or Trellis/u);
  assert.match(references, /does not reuse Trellis code/u);
  assert.ok(references.includes(TRELLIS_PROVENANCE_REVISION));
});

function normalizedTextIdentity(source: string): string {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function isIllustrativeUrl(url: string): boolean {
  return url.startsWith("https://github.com/org/repo/");
}

function normalizeUrl(url: string | undefined): string {
  assert.ok(url);
  return url.replace(/[.,;:]$/u, "");
}
