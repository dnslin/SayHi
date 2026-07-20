# Issue #35 — Skill bundle lock design

## Scope

Verify the release bundle supplied by the runtime without resolving the rolling Skill Registry. Core Project Store initialization and diagnosis verify that bundle before writing or accepting an installed manifest. The current CLI release declares no managed Skills, but still carries an explicit immutable Registry pin and exact empty file set; future Plugin releases replace that lock rather than resolving the Registry at runtime.

## Confirmed public seams

1. **Core Skill bundle verification** — `verifySkillBundle` accepts a lock and the complete released file set. It validates the durable Skill Lock, canonical lock identity, every locked file's content identity, and exact file-set equality.
2. **Project installation verification** — `initializeManagedProject` and `diagnoseManagedProject` bind an unchanged verified bundle to the release's `skillLockDigest`. A missing, modified, renamed/substituted, unexpected, or digest-mismatched bundle fails before installation writes or doctor accepts the Project Store.
3. **Phase execution materials** — dispatch and resume receive the same complete bundle alongside existing per-Agent Skill material. Core verifies the complete bundle before authorizing a capability, then confirms each requested `SKILL.md` is the locked file supplied by that bundle.

## Invariants

- The Registry is never read at runtime.
- A lock includes a full Registry commit, unique Skill names and paths, each released Skill file's algorithm-specific hash, upstream provenance, license, and sidecar identity.
- The lock digest is the canonical durable-record identity; it is the value persisted in the Project Manifest's installed versions.
- A release without managed Skills still uses an explicit immutable Registry pin and exact empty bundle; adding a managed Skill changes the lock digest and requires a new release.
- Each Phase execution binding persists that lock digest; authorization and Task resume reject any differently locked bundle even when its selected `SKILL.md` bytes are unchanged.
- The file set must be exact. Extra files are as invalid as missing files, because they can introduce unreviewed capabilities.
- A Task resume blocks in its current Phase through the existing workflow path; it never continues with changed bundle bytes.
- Equal bytes retain their identity across environments through the lock's declared hash algorithm. No platform path or line-ending normalization is performed beyond that algorithm's definition.

## Verification

Contract tests cover an unchanged bundle, LF canonicalization, missing/modified/renamed/unexpected files, release digest mismatch, installation and doctor rejection, dispatch rejection, and Task resume blocking. The final command runs the entire repository suite.
