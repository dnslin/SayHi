# SayHi Supply Chain and Update Specification

**Status:** Accepted design baseline

## 1. Repository roles

### 1.1 Skill Registry

[`dnslin/skills`](https://github.com/dnslin/skills) is the rolling collection of upstream and locally authored Skills. It records upstream revisions and may update independently of SayHi.

### 1.2 Framework Repository

`dnslin/sayhi` contains SayHi Core, CLI, OMP Plugin, sidecar contracts, documentation, build scripts, and release metadata. It does not track the Skill Registry at runtime.

### 1.3 Managed Project

A user repository records only the SayHi release and Skill Lock identity it installed. It does not vendor the Skill Registry's Git history.

## 2. Pinning model

A SayHi source revision pins:

- an immutable Skill Registry commit;
- every selected Skill directory and file hash;
- original upstream repository, path, and commit where known;
- license identifier and required notice;
- SayHi sidecar capability identity;
- inclusion class: required core or optional capability pack.

Tags aid human release management but the full commit and hashes are authoritative.

## 3. Build-time vendoring

The build pipeline MUST:

1. fetch or receive the exact locked Skill Registry revision;
2. reject a dirty or mismatched source tree;
3. copy only allowlisted Skill paths into a staging directory;
4. preserve nested references, scripts, metadata, and executable bits where required;
5. verify every staged file against the lock;
6. verify original Skills have not been modified by SayHi overlays;
7. generate the third-party inventory and notices;
8. combine Skills with separate SayHi sidecars and runtime assets;
9. package from staging rather than an arbitrary developer working tree;
10. re-open the package and verify its manifest before release.

Vendored files are build outputs. Contributors update the lock and source reference, not the packaged Skill text.

## 4. Core Skills

The required Matt engineering and productivity collection includes every Skill present in the locked upstream collection because Skills reference one another and standalone use remains supported.

The workflow automatically routes only the subset declared by SayHi sidecars. Bundling a Skill does not grant automatic invocation or repository authority.

## 5. Optional capability packs

Other Skill Registry entries may form named packs. A pack manifest declares:

- included Skills and locked identities;
- compatible SayHi/Core major versions;
- allowed Phases;
- manual or automatic invocation eligibility;
- maximum Agent contracts that may load each Skill;
- network and repository expectations;
- license inventory.

Projects enable packs explicitly. Unknown installed Skills remain manually accessible through OMP but are outside managed SayHi routing.

## 6. Upgrade discovery

Automation MAY monitor new Skill Registry revisions. It MUST create an upgrade proposal or PR and MUST NOT merge or publish automatically.

An upgrade report includes:

- old and new Registry commits;
- upstream commit changes;
- added, removed, renamed, and changed Skill files;
- normalized textual diff and non-text identity diff;
- detected frontmatter or invocation changes;
- cross-Skill reference changes;
- sidecar compatibility failures;
- license or notice changes;
- affected Phase Agents and tests;
- required SayHi version change.

Core Skill changes require human semantic review even when CI passes.

## 7. Release versioning

Packages use coordinated versions:

```text
@dnslin/sayhi-core
@dnslin/sayhi-cli
@dnslin/sayhi-omp
```

CLI and OMP Plugin declare a compatible Core range, but a release train SHOULD publish the same version for all three. Project schema and Agent contract versions are independent integers recorded in manifests.

Version changes follow these rules:

- breaking project-schema, CLI contract, Plugin Tool, or Agent contract changes require a major release unless a fully automatic backward-compatible migration exists within the declared support policy;
- additive optional fields and new diagnostics may be minor;
- corrections that do not change accepted contracts may be patch;
- a changed Skill Lock always produces a new SayHi release, never an in-place mutation.

## 8. Project updates

### 8.1 Ownership classes

- Engine-owned files update by exact installed-base identity.
- User-owned files are never template-replaced.
- Managed-customizable files use constrained composition or marker blocks.

### 8.2 Update phases

```text
compatibility check
  -> migration plan
  -> generated-file three-way plan
  -> Agent/Skill identity plan
  -> user review
  -> staged writes
  -> schema migration
  -> post-update doctor
```

An update conflict stops only after preserving local, base, and incoming variants plus a machine-readable report. SayHi MUST NOT resolve semantic prompt or workflow conflicts by taking “ours” or “theirs” automatically.

### 8.3 Rollback

V1 does not use Git reset as an updater rollback. Before applying, the updater preserves the installed manifest and replaced Engine-owned content in a local operation journal. It may restore files it just atomically replaced when no subsequent modification occurred. User-owned migrations require forward recovery or a documented manual plan.

## 9. Installation and Plugin distribution

The CLI package exposes the `sayhi` executable. The OMP Plugin is installed through OMP's supported npm, Git, link, or Marketplace path. Installation instructions MUST make clear that Plugin TypeScript/JavaScript is privileged executable code.

The Plugin package contains or references only package-local runtime dependencies. It MUST NOT assume a globally installed CLI for normal operation. CLI and Plugin both load Core as a library.

## 10. Reproducibility

A release SHOULD be reproducible from:

- SayHi source commit;
- dependency lockfile;
- Skill Lock;
- declared Node/toolchain version;
- build command;
- deterministic generated manifests.

Build outputs MUST exclude local runtime state, credentials, caches, unaccepted Quick records, and arbitrary developer files.

CI verifies:

- clean source tree;
- lockfile consistency;
- unit, contract, migration, adapter, and package tests;
- no unexpected Skill modifications;
- no missing license/provenance entry;
- Plugin layout and manifest validity;
- package contents allowlist;
- installed-package smoke test;
- update and uninstall behavior against representative fixtures.

## 11. Licensing

SayHi's independently authored code and documentation target the MIT License.

Every distributed copy includes:

- SayHi `LICENSE`;
- `THIRD_PARTY_NOTICES.md`;
- required upstream license texts or notices;
- generated Skill provenance with repository, commit, and path.

The Matt Skills MIT copyright and permission notice MUST accompany distributed substantial copies. Other capability packs are admitted only when their licenses are known and distribution is compatible with the chosen packaging.

Trellis is an architectural and behavioral research source under AGPL-3.0. SayHi releases MUST NOT contain Trellis source code, templates, prompt text, or copied documentation. Contributors implementing behavior SHOULD work from SayHi's accepted specifications and tests.

This specification is engineering policy, not legal advice; a public release SHOULD receive a final license review.

## 12. Registry health preconditions

The SayHi build MUST independently verify the Registry commit and files rather than assume the Registry's scheduled synchronization succeeded. Registry metadata is evidence, not sufficient integrity proof.

Before first public SayHi release, the Registry SHOULD:

- provide a root license for its own content;
- include third-party notices for synchronized content;
- ensure synchronization stages the actual managed root paths;
- expose immutable tags or releases suitable for human review.

SayHi's commit pin remains authoritative even if Registry tags move or automation fails.

## 13. Deprecation

Removal or replacement of a Skill, Agent contract, Tool, command, or durable schema field requires:

- a documented replacement or explicit no-replacement decision;
- compatibility diagnostics;
- migration behavior where durable project state is affected;
- release-note visibility;
- a defined support window before hard removal when practical.
