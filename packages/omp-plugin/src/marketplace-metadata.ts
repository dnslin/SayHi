import {
  COORDINATED_RELEASE_ARTIFACTS,
  type CoordinatedReleaseArtifacts,
} from "@dnslin/sayhi-core";

export interface OmpMarketplaceMetadata {
  readonly releaseArtifacts: CoordinatedReleaseArtifacts;
  readonly entryPoints: Readonly<{
    readonly core: Readonly<{
      readonly package: "@dnslin/sayhi-core";
      readonly export: ".";
    }>;
    readonly cli: Readonly<{
      readonly package: "@dnslin/sayhi-cli";
      readonly executable: "sayhi";
      readonly export: ".";
    }>;
    readonly omp: Readonly<{
      readonly package: "@dnslin/sayhi-omp";
      readonly export: ".";
    }>;
  }>;
  readonly requirements: Readonly<{
    readonly node: ">=22.17.0";
    readonly npm: ">=10.9.2";
  }>;
  readonly capabilities: Readonly<{
    readonly commands: readonly string[];
    readonly agents: readonly string[];
    readonly hooks: readonly string[];
    readonly mcpServers: readonly string[];
    readonly lspServers: readonly string[];
  }>;
}

export const OMP_MARKETPLACE_METADATA: OmpMarketplaceMetadata = Object.freeze({
  releaseArtifacts: COORDINATED_RELEASE_ARTIFACTS,
  entryPoints: Object.freeze({
    core: Object.freeze({ package: "@dnslin/sayhi-core", export: "." }),
    cli: Object.freeze({
      package: "@dnslin/sayhi-cli",
      executable: "sayhi",
      export: ".",
    }),
    omp: Object.freeze({ package: "@dnslin/sayhi-omp", export: "." }),
  }),
  requirements: Object.freeze({ node: ">=22.17.0", npm: ">=10.9.2" }),
  capabilities: Object.freeze({
    commands: Object.freeze([]),
    agents: Object.freeze([]),
    hooks: Object.freeze([]),
    mcpServers: Object.freeze([]),
    lspServers: Object.freeze([]),
  }),
});
