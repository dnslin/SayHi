# Issue #36 — Coordinated release artifacts design

## Scope

Publish one immutable coordinated release declaration for SayHi Core, CLI, and OMP. Each artifact exposes its version, shared source provenance, compatibility contract set, and SHA-256 integrity identity. Core validates that declaration and its exact locked Skill bundle before initializing or diagnosing a Managed Project; the Project Store continues to persist the derived installed component versions and Skill Lock digest.

## Design basis

- **Rejected assumption:** equal package versions alone prove compatibility. They cannot prove source provenance, contract versions, or the released Skill bundle.
- **Bedrock constraint:** an installer receives mutable input. It can reject a combination only when it recomputes an identity from the material it will trust and compares every component against that material.
- **Resulting design:** Core constructs and verifies one `CoordinatedReleaseArtifacts` value. Artifact metadata integrity covers its role, version, provenance, and compatibility; release integrity covers all artifact identities and the verified Skill Lock identity.
- **Alternative not chosen:** duplicate constants in Core, CLI, and OMP. That leaves independent edit paths and permits drift before an installation Gate observes it.

## Confirmed public seams

1. **Coordinated release verification** — Core creates and verifies an artifact set. It rejects malformed metadata, changed component version/provenance/compatibility/integrity, and a Skill bundle whose lock identity differs from every artifact’s declared compatibility.
2. **Managed Project installation and diagnosis** — `initializeManagedProject` and `diagnoseManagedProject` receive coordinated release artifacts, derive installed versions only after verification, and fail before writes for incompatible Core, CLI, OMP, or Skill bundle combinations.
3. **Artifact metadata exports** — Core, CLI, and OMP expose their respective metadata. Package versions, source provenance, compatibility, and integrity agree with the coordinated release declaration.

## Invariants

- Core, CLI, and OMP metadata have one declared provenance and one compatibility set.
- Every artifact integrity is the canonical SHA-256 identity of its immutable metadata material. The release integrity binds the three artifact identities and the verified Skill Lock identity.
- The compatibility set includes the project schema, templates, managed-project, record, and Skill-bundle contract versions plus the exact Skill Lock digest.
- The bundle is verified as a complete locked bundle before the installed Project Store version is derived or any directory/file is created.
- `doctor` validates its supplied release declaration before reading Project Store state; a manifest remains incompatible when its already-installed versions differ from the verified declaration.
- CLI consumes Core’s declaration; OMP exposes its matching Core-declared metadata. Neither maintains a second version or Skill Lock constant.

## Verification

Contract tests cover a valid release, canonical integrity, package-version alignment, mismatched Core/CLI/OMP metadata, changed provenance and contract compatibility, invalid/mismatched Skill bundles, and proof that rejected initialization produces no writes. The final command runs the complete repository suite.
