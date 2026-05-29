// Postinstall fix for running QVAC's native .bare addons in Node on Windows x64.
//
// Two host-specific problems are handled here (no-op on non-Windows):
//
//   1. QVAC's llama.cpp .bare addons link against OpenSSL 3
//      (libcrypto-3-x64.dll, libssl-3-x64.dll), which Windows does not ship and
//      the npm packages do not bundle. The Bare addon loader searches the
//      addon's own directory, so we copy the DLLs next to every win32-x64
//      prebuilt .bare addon.
//
//   2. The win32 Bare interpreter (bare-runtime-win32-x64) must be present. That
//      is handled by `pnpm.supportedArchitectures` in the root package.json plus
//      `pnpm install`; here we just verify and warn if it is missing.
//
// The OpenSSL DLLs are sourced from (in order):
//   - $HIRAIA_OPENSSL_DIR
//   - a vendored copy at scripts/vendor/win32-openssl/
//   - Git for Windows (C:\Program Files\Git\mingw64\bin)

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")

const DLLS = ["libcrypto-3-x64.dll", "libssl-3-x64.dll"]

function log(...a) {
  console.log("[fix-qvac-win32]", ...a)
}

if (process.platform !== "win32") {
  log("Non-Windows platform; nothing to do.")
  process.exit(0)
}

function findOpenSslDir() {
  const candidates = [
    process.env.HIRAIA_OPENSSL_DIR,
    path.join(__dirname, "vendor", "win32-openssl"),
    "C:\\Program Files\\Git\\mingw64\\bin",
    "C:\\Program Files\\Git\\mingw64\\libexec\\git-core",
  ].filter(Boolean)

  for (const dir of candidates) {
    if (DLLS.every((d) => fs.existsSync(path.join(dir, d)))) {
      return dir
    }
  }
  return null
}

function findBareAddonPrebuildDirs() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm")
  if (!fs.existsSync(pnpmDir)) return []

  const results = []
  const walk = (dir, depth) => {
    if (depth > 8) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const full = path.join(dir, e.name)
      if (e.name === "win32-x64" && full.includes("prebuilds") && full.includes("qvac")) {
        results.push(full)
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(pnpmDir, 0)
  return results
}

function checkBareRuntime() {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm")
  if (!fs.existsSync(pnpmDir)) return false
  return fs
    .readdirSync(pnpmDir)
    .some((n) => n.startsWith("bare-runtime-win32-x64@"))
}

function main() {
  if (!checkBareRuntime()) {
    log(
      "WARNING: bare-runtime-win32-x64 not found. Ensure root package.json has " +
        "pnpm.supportedArchitectures (os: win32, cpu: x64) and run `pnpm install --force`.",
    )
  }

  const srcDir = findOpenSslDir()
  if (!srcDir) {
    log(
      "WARNING: could not locate OpenSSL 3 DLLs (libcrypto-3-x64.dll, libssl-3-x64.dll). " +
        "Set HIRAIA_OPENSSL_DIR or install Git for Windows. QVAC native addons will fail to load without them.",
    )
    return
  }
  log(`Using OpenSSL DLLs from: ${srcDir}`)

  const targets = findBareAddonPrebuildDirs()
  if (targets.length === 0) {
    log("No QVAC win32-x64 prebuild dirs found (is @qvac/sdk installed?).")
    return
  }

  let copied = 0
  for (const dir of targets) {
    for (const dll of DLLS) {
      const dest = path.join(dir, dll)
      try {
        fs.copyFileSync(path.join(srcDir, dll), dest)
        copied++
      } catch (err) {
        log(`Failed to copy ${dll} -> ${dir}: ${err.message}`)
      }
    }
  }
  log(`Done. Copied ${copied} DLL(s) into ${targets.length} addon dir(s).`)
}

main()
