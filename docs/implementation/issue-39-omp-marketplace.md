# Issue #39 — OMP Marketplace metadata and installation guidance

## Scope

Publish an OMP Marketplace catalog for SayHi and a package-level metadata interface that lets a user identify the coordinated Core, CLI, and OMP release; obtain the three packages; verify the exact release declaration; initialize or update a Managed Project; and safely remove the project and packages.

## Design basis

- **Rejected assumption:** a Marketplace catalog can install the npm-distributed OMP artifact today. OMP declares npm plugin sources but its current Marketplace installer does not support them; the catalog must use the supported Git-relative source form.
- **Rejected assumption:** Marketplace metadata may advertise the OMP command, hook, Tool, Agent, or Skill surfaces already specified for a future Plugin. The current package exports shared library contracts only, so declaring such capabilities would be false.
- **Bedrock constraint:** release identity changes with the build provenance. Copying artifact versions or SHA-256 values into a static catalog creates a second authority and will eventually drift.
- **Resulting design:** `.omp-plugin/marketplace.json` is a standards-shaped, Git-installable catalog that explicitly declares no current OMP runtime capabilities. `OMP_MARKETPLACE_METADATA` is the package-level verification interface: it directly references Core's immutable `COORDINATED_RELEASE_ARTIFACTS`, names the Core/CLI/OMP entry points, and records the Node/npm host requirements. It is the sole location outside Core that exposes release identity, and it derives that identity rather than reconstructing it.

## Public interface and assets

| Asset | Interface | Responsibility |
| --- | --- | --- |
| `.omp-plugin/marketplace.json` | OMP catalog | Names the `sayhi` catalog/plugin, supported Git-relative source, provenance links, and the empty current command/agent/hook/MCP/LSP capability sets. |
| `@dnslin/sayhi-omp` | `OMP_MARKETPLACE_METADATA` | Exposes the canonical coordinated release declaration, the three package entry points, host version requirements, and declared runtime capabilities. |
| `packages/omp-plugin/README.md` | Installation guide | Gives clean-environment pack/install/verification/configuration/update/uninstall commands; distinguishes the catalog from the release-artifact installation. |
| `packages/{core,cli,omp}/LICENSE` and `THIRD_PARTY_NOTICES.md` | Package distribution notices | Keeps each coordinated npm artifact independently license and notice complete. |
| `README.md` | Documentation index | Links users to the canonical guide. |

## Confirmed test seams

1. **Package metadata export** — consumers import `OMP_MARKETPLACE_METADATA` from `@dnslin/sayhi-omp`; tests observe its release identity, entry points, required host versions, and empty current OMP capability surface without reaching into package internals.
2. **OMP catalog** — a JSON parse smoke check verifies the actual root catalog has OMP-required identity/source fields, points inside the repository, and makes no unavailable capability claim.
3. **Installed coordinated artifacts** — the existing packed-artifact contract matrix installs Core, CLI, OMP, and testing packages into a fresh temporary environment, then exercises `init`, `doctor`, update planning, and uninstall. The new public metadata export is included in that installed matrix through the existing OMP contract.

## Implementation slices

1. Add the public derived metadata module and extend the existing OMP contract test first; the test must fail because the export does not exist.
2. Implement the minimal metadata module and public export; run the focused OMP contract test until it passes.
3. Add the OMP catalog and canonical package guide, then manually parse the catalog and exercise the documented clean package lifecycle.
4. Run typecheck, the focused contract, the complete suite, and a two-axis review against `master`; repair any finding before commit.

## Lifecycle guidance contract

- **Obtain:** build a clean source revision and locally pack/install the exact Core, CLI, and OMP tarballs together. The Marketplace catalog remains Git-based because OMP cannot install npm Marketplace sources yet.
- **Verify:** import `OMP_MARKETPLACE_METADATA` and use Core's release verifier before calling `sayhi init` or `sayhi doctor`.
- **Configure:** use `sayhi init` and review the generated Project Store configuration; no Marketplace capability must be enabled because this release declares none.
- **Update:** install a coordinated release train together, run `sayhi update --dry-run`, resolve any ownership conflict, then apply and run `doctor`.
- **Uninstall:** run `sayhi uninstall --dry-run`, then `--apply` only after reviewing retained user-owned content; remove the Marketplace catalog/plugin and npm packages separately.

## Non-goals

- Implementing OMP commands, hooks, Tools, Agents, Skills, or extension entry points.
- Adding unsupported npm Marketplace installation.
- Duplicating Core's release identity in static JSON.
- Changing Core installation, migration, or file-ownership behavior.
