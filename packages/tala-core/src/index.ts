/**
 * @hiraia/tala-core — shared by tala-web, tala-mobile and tala-server.
 * Pure TypeScript: no Node, DOM or React Native APIs in anything exported from here
 * (the API client uses only `fetch`/`AbortController`, which all three platforms provide).
 *
 * OWNER of this file: orchestrator. Each area below has its own index.ts owned by one workstream.
 */
export * from './contracts';
export * as tokens from './tokens';
export * as pacing from './pacing';
export * as curriculum from './curriculum';
export * as generation from './generation';
export * as roster from './roster';
export * as sample from './sample';
export * as moderation from './moderation';
export * as plan from './plan';
export * as print from './print';
export * as sync from './sync';
