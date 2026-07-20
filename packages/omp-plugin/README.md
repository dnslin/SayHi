# SayHi OMP release

This package exposes SayHi's OMP-facing library contract and the coordinated-release metadata used to verify Core, CLI, and OMP artifacts. It does not yet provide OMP runtime commands, Agents, hooks, MCP servers, or LSP servers.

## Marketplace catalog

OMP Marketplace currently supports Git-based plugin sources, not npm package sources. The repository catalog is therefore Git-relative:

```sh
omp plugin marketplace add dnslin/SayHi
omp plugin install --scope project sayhi@sayhi
```

The catalog entry deliberately declares no runtime capabilities. A successful catalog installation is not activation of a SayHi OMP runtime; use the coordinated package installation below for the working Core/CLI/OMP artifact set.

## Clean, verified installation

Use a clean SayHi source revision and keep all three artifacts from one release train together. The repository requires Node.js `>=22.17.0` and npm `>=10.9.2`.
Each coordinated tarball contains SayHi's `LICENSE` and `THIRD_PARTY_NOTICES.md`.

```sh
npm ci
npm run build
mkdir artifacts clean-install
npm pack --workspace=@dnslin/sayhi-core --pack-destination artifacts
npm pack --workspace=@dnslin/sayhi-cli --pack-destination artifacts
npm pack --workspace=@dnslin/sayhi-omp --pack-destination artifacts
(
  cd clean-install
  npm init --yes
  npm install --offline --ignore-scripts --no-audit --no-fund --no-save ../artifacts/*.tgz
)
```

From `clean-install`, verify the package exports before creating a Managed Project:

```sh
node --input-type=module --eval 'import { coreContract } from "@dnslin/sayhi-core"; import { CLI_RELEASE_ARTIFACT } from "@dnslin/sayhi-cli"; import { OMP_MARKETPLACE_METADATA, OMP_RELEASE_ARTIFACT } from "@dnslin/sayhi-omp"; const release = OMP_MARKETPLACE_METADATA.releaseArtifacts; const verified = coreContract.verifyTrustedCoordinatedReleaseArtifacts(release); if (!verified.ok || CLI_RELEASE_ARTIFACT.integrity !== release.artifacts.cli.integrity || OMP_RELEASE_ARTIFACT.integrity !== release.artifacts.omp.integrity) throw new Error("SayHi packages are not one verified coordinated release."); console.log(release.integrity);'
```

`npm install` performs npm's tarball-integrity handling. The command below verifies a separate property: the release metadata equals Core's canonical compiled declaration and the installed CLI/OMP exports match its artifacts. Preserve the `npm pack` output with release evidence when byte-level package provenance must be audited.

## Configure a Managed Project

Initialize only inside a Git repository. From `clean-install`, target that repository explicitly and retain JSON output for review:

```sh
./node_modules/.bin/sayhi init --cwd /path/to/project --json
./node_modules/.bin/sayhi doctor --cwd /path/to/project --json
```

Review the generated `.sayhi/config.yaml` and the ownership plan before changing it. This OMP catalog has no capability that needs enabling.

## Update

Pack the next Core, CLI, and OMP artifacts into a fresh directory, install exactly those tarballs, rerun the verification command, then plan the Managed Project update before changing files:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund --no-save /path/to/next-artifacts/*.tgz
./node_modules/.bin/sayhi update --dry-run --cwd /path/to/project --json
./node_modules/.bin/sayhi update --apply --cwd /path/to/project --json
./node_modules/.bin/sayhi doctor --cwd /path/to/project --json
```

A conflict preserves the local, installed-base, and incoming versions. Do not replace user-owned files or bypass the dry-run review.

## Uninstall

Remove Managed Project content before removing the packages. The dry run reports retained user-owned content and every planned file action:

```sh
./node_modules/.bin/sayhi uninstall --dry-run --cwd /path/to/project --json
./node_modules/.bin/sayhi uninstall --apply --cwd /path/to/project --json
omp plugin uninstall --scope project sayhi@sayhi
omp plugin marketplace remove sayhi
npm uninstall @dnslin/sayhi-core @dnslin/sayhi-cli @dnslin/sayhi-omp
```

`omp plugin marketplace remove sayhi` also removes associated Marketplace plugins. `sayhi uninstall` never removes npm packages or the Marketplace catalog for you.
