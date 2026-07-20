# Issue #38 — Skill upgrade proposal design

## Scope

Compare a complete discovered Skill Bundle with a complete locked release Skill Bundle and return a human-reviewable, immutable proposal. The report includes lock and upstream provenance, exact file identities, normalized textual evidence, renamed-file detection, frontmatter/invocation and cross-Skill reference changes, license/notice review state, affected Phase Agent capabilities and tests, compatibility failures, and the required SayHi release impact. Discovery is a Supply Chain operation: it does not resolve the Registry during runtime, rewrite a release, or receive a Project Store or Task mutation port.

## Design basis

- **Rejected assumption:** different Registry commits or changed Skill bytes prove an upgrade is safe. They do not prove that the source repository is the same, that locked Skills remain available, or that a changed sidecar is compatible with the Phase Agent Skill capability that selects it.
- **Bedrock constraint:** a locked release and a running Task are immutable identities. A function that receives only immutable data and returns a value cannot modify either identity.
- **Resulting design:** Core exposes one pure `proposeSkillUpgrades` module. It independently verifies both complete bundles, snapshots their registry/lock provenance and per-Skill file identities, normalizes textual bundle evidence to LF for review, and compares each named Skill. The caller supplies existing Phase Agent Skill capabilities, affected tests, and explicitly allowed replacement sidecar identities.
- **Evidence limit:** the Skill Lock carries license and sidecar identities, not notice or sidecar payloads. The proposal reports exact identity changes and requires notice inventory review when a Skill is added, removed, or changes license; it never invents unavailable notice or invocation data.
- **Alternative not chosen:** update an existing `Skill Lock` or reuse the runtime resolver. Changing the lock changes the release identity; resolving the Registry at runtime violates offline reproducibility and could affect an active Task.

## Confirmed public seam

1. **Skill upgrade proposal** — `proposeSkillUpgrades` accepts a locked bundle, a candidate bundle, declared Phase Agent `kind: "skill"` capabilities, affected test paths, and explicit sidecar compatibility constraints. It returns a frozen proposal containing exact before/after identities, Registry and upstream provenance, file-level added/removed/renamed/changed evidence, normalized text where available, semantic review indicators, license/notice review state, release impact, compatibility results, and affected Agent capabilities/tests. It has no filesystem, Task, or release mutation dependency.

## Compatibility rules

- Both bundles must pass `verifySkillBundle` before comparison.
- The candidate Registry repository must equal the locked Registry repository.
- Every locked Skill must remain present in the candidate bundle. Candidate Skills may be added and are reported.
- A changed sidecar identity is incompatible unless the caller explicitly lists it as allowed for that named Skill.
- Each declared Agent Skill capability must name a Skill in the locked bundle; each affected test must name a locked or candidate Skill.
- A changed Skill Lock always reports `new-release`; it is never an in-place release update.

## Invariants

- The current lock identity and candidate lock identity are separately reported; no lock object is returned by reference.
- Every changed, added, removed, or identity-preservingly renamed Skill file reports exact SHA-256 identities. `sha256-lf-v1` content, whether supplied as a string or `Uint8Array`, is decoded and LF-normalized as review evidence; `sha256-bytes-v1` files remain identity-only.
- The report compares `SKILL.md` frontmatter plus its declared invocation fields and scans selected Skill text for exact-name cross-Skill references. This analysis is review evidence, never a runtime permission decision.
- Every Skill change reports before/after upstream license, explicit changed `LICENSE`/`NOTICE` file evidence, and whether notices require human inventory review. Sidecar identity changes remain exact compatibility evidence; absent sidecar payloads are not inferred.
- A compatibility failure remains reviewable data. It never becomes a release or Task mutation.
- The returned proposal, nested records, arrays, and identities are frozen snapshots.
- A caller can decline or postpone by discarding the proposal; its inputs contain no mutation port and remain byte-for-byte unchanged.

## Verification seam

Contract tests exercise the exported Core interface:

1. a compatible candidate reports exact changed identities, provenance, normalized text, semantic evidence, affected Phase Agent capabilities/tests, and the required new-release impact;
2. an identity-preserving file rename remains a rename with normalized LF text and exact before/after hashes;
3. `sha256-bytes-v1` string content remains identity-only rather than receiving normalized text evidence;
4. changed upstream licenses and changed `LICENSE`/`NOTICE` files require inventory review;
5. `SKILL.md` frontmatter and invocation fields are detected when the closing marker reaches EOF;
6. Registry-source, removed-Skill, and unapproved-sidecar cases are returned as incompatible proposals;
7. an explicit sidecar allowance is accepted;
8. malformed input is rejected; and
9. generating then discarding a proposal preserves a representative release bundle and active Task hash.
