// Small-model source/checksum: SDK 0.17.1's SMOLLM2_360M_INST_Q8 registry entry.
// Hiraia/LaBSE URLs/sizes: unified/src/config/model.ts integrity table.
// Hiraia SHA-256 measured from local v2 bytes (2026-09-05): size and MD5 match
// unified's enforced integrity table. Its SHA-256 comment was stale (b13e...);
// do not use that comment's digest for v2. LaBSE's measured SHA matches its table.
export const MODELS = {
  small: {
    name: 'SmolLM2 360M', filename: 'smollm2-360m-instruct-q8_0.gguf',
    bytes: 386404992,
    sha256: '48ab3034d0dd401fbc721eb1df3217902fee7dab9078992d66431f09b7750201',
    url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/resolve/593b5a2e04c8f3e4ee880263f93e0bd2901ad47f/smollm2-360m-instruct-q8_0.gguf',
  },
  hiraia: {
    name: 'Hiraia-2B v2', filename: 'hiraia-sft-2b-v2.Q4_K_M.gguf',
    bytes: 1274396160,
    sha256: '7aec3b3b3ba0f131341ca2e09f676a651c2ed30de133570bb05069fca5dc5cbb',
    url: 'https://hiraia.b11.dev/models/hiraia-sft-2b-v2.Q4_K_M.gguf',
  },
  labse: {
    name: 'LaBSE', filename: 'labse.Q4_K_M.gguf', bytes: 383762048,
    sha256: '3869330197b5a583afc572104bf93393e384c72473a15c2dae43cab43e194b3e',
    url: 'https://hiraia.b11.dev/models/labse.Q4_K_M.gguf',
  },
};
