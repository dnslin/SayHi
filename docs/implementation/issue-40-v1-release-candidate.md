# Issue #40 — Reproducible V1 release candidate design

## Scope

Produce a release candidate from a clean, locked SayHi source revision and retain a self-verifying evidence directory. The candidate contains the coordinated Core, CLI, and OMP tarballs plus a deterministic `release-evidence.json`; it proves two isolated builds have identical package manifests, content inventories, and archive hashes. It also runs the complete installed V1 contract matrix from the packed testing artifact.

The release candidate does not publish packages, resolve the Skill Registry, mutate a Managed Project, or create a second coordinated-release declaration.

## Design basis

- **Rejected assumption:** a passing source-workspace suite or equal package versions proves a releasable artifact. Build output can differ, tarballs can omit files, and a package can be installed with incompatible peer artifacts.
- **Bedrock constraints:** the exact Git revision, `package-lock.json`, declared minimum Node version, exact `packageManager` npm version, and immutable Skill Lock are the inputs that determine a release. A tarball’s SHA-256 and its `npm pack` inventory are independently observable. The existing Core declaration is the sole authority for coordinated artifact provenance and compatibility.
- **Resulting design:** `release:candidate` rejects a dirty source worktree, makes two temporary detached clones of the same revision, verifies the active Node satisfies each checkout’s `engines.node` and active npm exactly equals its `packageManager` before `npm ci`, then builds and packs Core/CLI/OMP. It compares package manifests extracted from the tarballs, tarball content inventories, npm integrity identities, and archive SHA-256 values; it retains the first set as the candidate. The first checkout runs the complete workspace V1 suite, then the retained tarballs plus the packed testing artifact run the established installed V1 contract matrix. A JSON evidence record binds the verified release declaration to the source, dependency lock, Skill Bundle, artifact identities, compatibility, successful Milestone Exit Gates, and the separately observed installed matrix.
- **Alternative not chosen:** compare source `dist/` directories or write a static release manifest. Source outputs do not prove npm package contents, and a static manifest would duplicate Core’s coordinated declaration and drift.

## Confirmed public seams

1. **Release candidate command** — `npm run release:candidate -- --output <directory>` requires a clean Git worktree, the declared Node minimum, and exact declared npm toolchain, then writes three tarballs plus `release-evidence.json`. It fails if either isolated locked build differs, the complete workspace V1 suite fails, or the installed contract matrix fails.
2. **Release evidence verifier** — `npm run verify:release-candidate -- --input <directory>` validates the evidence shape, recomputes every retained archive’s SHA-256, SHA-512 npm integrity, embedded package-manifest digest, and content inventory, then confirms that the recorded Core/CLI/OMP exports form Core’s trusted coordinated declaration.
3. **Installed V1 acceptance** — the candidate installs packed Core, CLI, OMP, and testing artifacts into a clean temporary environment. It imports the existing `INSTALLED_CONTRACT_FILES` matrix from the packed testing artifact and requires exact equality with the release tool’s trusted V1 list, preserving the established Quick/Build, recovery, negative-safety, update, and uninstall coverage without reaching into source-repository-only documents.

## Invariants

- Candidate creation reads no Registry and declares the complete Core Skill Bundle lock, files, and digest from the trusted release declaration.
- The only retained release artifacts are Core, CLI, and OMP tarballs. The packed testing artifact exists only in the temporary acceptance environment.
- Every retained tarball has a canonical relative filename, archive SHA-256 digest, SHA-512 npm integrity value, SHA-256 digest of its embedded `package/package.json`, and sorted tarball content inventory.
- Two builds must agree exactly on source provenance, dependency-lock digest, active Node version satisfying the declared minimum, exact declared npm version, release declaration, artifact filenames, embedded package-manifest digests, inventories, npm integrity values, and archive SHA-256 values. There is no timestamp or machine-local path in evidence.
- Evidence carries one passed Gate record for each Milestone 0–5 only after the first isolated checkout’s complete `npm test` succeeds. A separate passed installed-acceptance record names the exact packed testing-artifact contract files that ran; that list must equal the trusted V1 matrix.
- Verification fails closed for malformed evidence, missing/extra artifacts, mismatched archive bytes, SRI, embedded package manifests, inventories, malformed relative paths, an altered installed contract matrix, or a Core/CLI/OMP declaration that Core does not trust.

## Implementation slices

1. Add a contract test for stable evidence construction, declared Node/npm toolchain enforcement, and fail-closed comparison of mismatched builds, missing Gates, malformed artifact records, unlisted tarballs, and mismatched archive identities, manifests, or inventories.
2. Implement the release-candidate script: clean-state check, two temporary Git clones, declared Node and exact npm verification before locked installs/builds, packing, canonical comparison, complete workspace V1 acceptance, trusted temporary installed acceptance, evidence creation, and archive retention.
3. Implement evidence verification: recompute retained archive SHA-256/SRI, embedded package manifests, and inventories; install the artifacts in a fresh temporary directory; and compare the three exported artifacts against Core’s trusted coordinated declaration.
4. Add `release:candidate` and `verify:release-candidate` workspace commands. Run the focused script contract, typecheck, the complete suite, a real candidate build, and candidate verification.

## Verification

- The script contract uses known-good literal release data to prove exact evidence fields are accepted and mismatched builds, missing Gate coverage, invalid artifact hashes, unlisted archives, and tampered archive SRI, manifests, or inventories are rejected.
- A real candidate command performs two isolated builds, the complete workspace V1 suite, and the trusted established installed V1 contract matrix.
- The verifier recomputes the real retained archives’ SHA-256/SRI, embedded manifests, and inventories, then rechecks coordinated release metadata from a fresh installation.
- The full repository suite remains the final regression check.
