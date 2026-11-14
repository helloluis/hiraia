# Standalone QVAC build island

This private package is deliberately outside the root workspace's `packages/*` glob. Its own `pnpm-workspace.yaml`, `.npmrc`, virtual store and **nested** lockfile keep SDK 0.23.0/Bare peers out of the shipping student/server/desktop lock graph. Do not add its dependencies back to the parent package or link it as a workspace dependency.

Install with pnpm 9.15.9:

```sh
pnpm --dir packages/tala-mobile/qvac-build install --ignore-workspace --frozen-lockfile
```

The parent app normally uses its ordinary workspace dependencies. This island also contains matching Expo/RN build tools so it can be verified without regenerating the root lockfile. If the parent's generated dependencies were removed, `node packages/tala-mobile/qvac-build/prepare-tools.cjs` exposes only the parent standard manifest's dependencies locally. It never writes root node_modules or a root lockfile. This bootstrap is optional and does not expose QVAC/Bare as parent dependencies.

From the parent package, run:

```sh
TALA_QVAC=1 bash scripts/build-variant.sh
```

The parent app config resolves build properties from this island only for QVAC. Its native React Native config/search path selects this island's Bare kit, Metro scopes SDK/Bare imports here, and the worker/native linker uses the same private process import map as before. The SDK's generated native-link entry is placed here so its imports resolve against this package. No global alias or root peer pin is used. Standard uses no QVAC plugin and still excludes Bare natively.

`pnpm --dir qvac-build run type-check` (from the parent) checks the optional engine adapter. The parent's type-check excludes that optional file and the island, so a standard-only workspace install needs no SDK. Shared Tala core resolves as live monorepo source through parent TypeScript/Metro mappings.

Only this nested lockfile is generated/committed for the experimental build. The root lockfile is maintained by the orchestrator. SDK/native/runtime versions must be reviewed when updating this island. No model is bundled; existing model opt-in and physical-device verification limits remain.
