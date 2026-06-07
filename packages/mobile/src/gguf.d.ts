// Metro treats .gguf as an asset (see metro.config.js assetExts). Importing one
// yields the asset module id (a number) for expo-asset's Asset.fromModule().
declare module '*.gguf' {
  const asset: number;
  export default asset;
}

// The int8 semantic-vectors blob, same asset treatment as .gguf.
declare module '*.bin' {
  const asset: number;
  export default asset;
}
