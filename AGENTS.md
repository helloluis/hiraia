# Working checkout

Use `/Users/luis/Code/hiraia` as the default local working directory. The consolidated
development branch is `hiraia-unified`. Check the current branch and working tree
before editing; other agents may share this checkout. Preserve unrelated changes.

Prefer continuing here for ordinary work. Create an isolated worktree only when
the task needs isolation, and bring its completed work back into this checkout.
Do not resume work in the retired `hiraia-*` directories from earlier handoffs.

The 21 September 2026 consolidation is documented in
`docs/WORKSPACE-CONSOLIDATION-20260921.md`. Old worktree files, local changes and Git
metadata are preserved under
`/Users/luis/Code/hiraia-worktree-archive/20260921-consolidation/`.
Those snapshots are recovery material, not current build inputs.

# Mobile build inputs

Read `packages/mobile/BUILD.md` before building. `cards.db`, token data, voice
weights and image packs include ignored build inputs; a clean Git status alone
does not establish that they are present or current. Use the repository build
script and its content, image and voice checks. Preserve the established signing
identity, and do not publish or change release versions without task authorization.
After `build-apk.sh`, use `packages/mobile/scripts/sign-apk.sh` for an installable
release artifact; Gradle's `app-release.apk` uses the debug key. The signing script
verifies the established release certificate and writes the versioned APK.

For Cebuano edits, follow the evidence requirements in `CLAUDE.md` and
`docs/TRANSLATION-LEXICON-DEFECTS.md`; merging the completed audit does not authorize
applying its held proposals.
