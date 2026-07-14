# Third-Party Notices

This bootstrap workspace does not bundle or copy third-party runtime implementation code, OMP implementation code, Trellis artifacts, or Skill content.

The npm development toolchain installs these third-party packages:

| Package | Version | License |
| --- | --- | --- |
| TypeScript and its platform packages | 7.0.2 | Apache-2.0 |
| `@types/node` | 26.1.1 | MIT |
| `undici-types` | 8.3.0 | MIT |

The dependency graph, package sources, and integrity hashes are recorded in `package-lock.json`. License texts for development dependencies remain with the packages installed by npm; those packages are not included in SayHi source or runtime artifacts.

No Skill bundle is present in this milestone. A future distribution that includes Skills or other upstream content must add their provenance and required license texts or notices before release.
