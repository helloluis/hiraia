// Ambient declarations for the non-code files Metro packages as ASSETS
// (see metro.config.js `assetExts`). Importing one yields the asset module id (a
// number), which expo-asset resolves to a real file path at runtime via
// Asset.fromModule().
//
// There is deliberately NO '*.gguf' declaration. The LoRA adapters were the only
// bundled .gguf; they are downloaded from the mirror and integrity-checked now
// (src/config/model.ts REMOTE_ASSETS), so a `.gguf` import would be a mistake —
// leaving this undeclared makes that mistake a compile error rather than 213.5 MB
// of silently re-bundled APK.

// The int8 semantic-vectors blob — read into an Int8Array for the SemanticIndex.
declare module '*.bin' {
  const asset: number;
  export default asset;
}

// The prebuilt card-text database. Importing it yields the module id expo-asset
// resolves to a file we copy out of the APK on first run.
declare module '*.db' {
  const asset: number;
  export default asset;
}
