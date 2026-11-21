#!/usr/bin/env bash
# Run on b11-apps. Builds the live web source + the Siay Dev Diary entry in an isolated stage.
# No production writes. Inputs: /tmp/devdiary-siay/{DevDiary.tsx,siay-nhs-phones.jpg}
set -euo pipefail
LIVE=/root/hiraia; IN=/tmp/devdiary-siay; ST=/var/tmp/hiraia-devdiary-siay-20261121
test ! -e "$ST" || { echo "stage exists: inspect $ST"; exit 1; }
test "$(cat $LIVE/packages/web/.next/BUILD_ID)" = tP_ccIaUbEKyvK7FgFPzz
echo "fd5c8cb3463ad7b713ea8e7e096f08275e1d547151014e9f3ab00c47148ed6aa  $LIVE/packages/web/src/components/DevDiary.tsx" | sha256sum -c
echo "4d32d1a101331f89db7ce853219f80538fe2207e185ba2a973da6a00ade60472  $IN/siay-nhs-phones.jpg" | sha256sum -c
test ! -e $LIVE/packages/web/public/dev-diary/siay-nhs-phones.jpg
mkdir -p $ST/packages
cp -a $LIVE/package.json $LIVE/pnpm-lock.yaml $LIVE/pnpm-workspace.yaml $LIVE/tsconfig.base.json $ST/
ln -s $LIVE/node_modules $ST/node_modules; ln -s $LIVE/docs $ST/docs; ln -s $LIVE/rag $ST/rag
cp -a $LIVE/packages/mobile $ST/packages/ 2>/dev/null || true
cp -a $LIVE/packages/shared $ST/packages/
rsync -a --exclude .next --exclude node_modules --exclude .env.local --exclude .turbo \
  --exclude .DS_Store --exclude tsconfig.tsbuildinfo --exclude .telemetry $LIVE/packages/web/ $ST/packages/web/
ln -s $LIVE/packages/web/node_modules $ST/packages/web/node_modules
install -m 0644 $IN/DevDiary.tsx $ST/packages/web/src/components/DevDiary.tsx
install -m 0644 $IN/siay-nhs-phones.jpg $ST/packages/web/public/dev-diary/siay-nhs-phones.jpg
cd $ST/packages/web
NEXT_TELEMETRY_DISABLED=1 HIRAIA_DB_PATH=$ST/fixture.db pnpm build > $ST/build.log 2>&1 || { tail -40 $ST/build.log; exit 1; }
tail -5 $ST/build.log
# Keep the exact live donation widget (the build regenerates it with new hashes).
mkdir -p $ST/generated-widget-not-selected
mv public/donate-widget $ST/generated-widget-not-selected/
cp -a $LIVE/packages/web/public/donate-widget public/donate-widget
# Public tree must equal live except the one new photo.
diff -rq $LIVE/packages/web/public public | tee $ST/public-diff.txt
test "$(cat $ST/public-diff.txt)" = "Only in public/dev-diary: siay-nhs-phones.jpg"
# Source must differ from live only in DevDiary.tsx.
diff -rq $LIVE/packages/web/src src | tee $ST/src-diff.txt
test "$(cat $ST/src-diff.txt)" = "Files $LIVE/packages/web/src/components/DevDiary.tsx and src/components/DevDiary.tsx differ"
grep -rl "siay-nhs-phones.jpg" .next/server/app/index.html .next/static >/dev/null && echo "entry present in build"
echo "STAGED BUILD_ID $(cat .next/BUILD_ID)"
