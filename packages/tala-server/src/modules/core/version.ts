/**
 * What `system.health` reports as the server's version.
 * OWNER: workstream A.
 *
 * The number is written here rather than read from package.json at run time, so it survives any bundler the
 * server is mounted through. A test keeps it equal to the package's own version.
 */
export const SERVER_VERSION = '0.1.0';

/** `0.1.0`, or `0.1.0+<build>` when the deploy names its build (TALA_BUILD_ID, for example a commit id). */
export function serverVersion(buildId: string | undefined): string {
  const build = (buildId ?? '').trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(build) ? `${SERVER_VERSION}+${build}` : SERVER_VERSION;
}
