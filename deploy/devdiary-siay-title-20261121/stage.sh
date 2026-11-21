#!/usr/bin/env bash
# Run on b11-apps. Rebuilds the live web source with only the Siay entry title corrected. No production writes.
set -uo pipefail
LIVE=/root/hiraia; IN=/tmp/devdiary-siay-title; ST=/var/tmp/hiraia-devdiary-siay-title-20261121
set -e
test ! -e "$ST" || { echo "stage exists: inspect $ST"; exit 1; }
test "$(cat $LIVE/packages/web/.next/BUILD_ID)" = g_dqKl1Y4beKguRcfjsju
echo "c7dbfe9340a4aecbe25a933a100d7c3b8652528c7b47dbbc8e76176a7c15bf9f  $LIVE/packages/web/src/components/DevDiary.tsx" | sha256sum -c
echo "af80081bbb82e6187c7fc990091100e4012b8a55ca3ac06549e94ba52b977d07  $IN/DevDiary.tsx" | sha256sum -c
mkdir -p $ST/packages
cp -a $LIVE/package.json $LIVE/pnpm-lock.yaml $LIVE/pnpm-workspace.yaml $LIVE/tsconfig.base.json $ST/
ln -s $LIVE/node_modules $ST/node_modules; ln -s $LIVE/docs $ST/docs; ln -s $LIVE/rag $ST/rag
cp -a $LIVE/packages/mobile $ST/packages/ 2>/dev/null || true
cp -a $LIVE/packages/shared $ST/packages/
rsync -a --exclude .next --exclude node_modules --exclude .env.local --exclude .turbo \
  --exclude .DS_Store --exclude tsconfig.tsbuildinfo --exclude .telemetry $LIVE/packages/web/ $ST/packages/web/
ln -s $LIVE/packages/web/node_modules $ST/packages/web/node_modules
install -m 0644 $IN/DevDiary.tsx $ST/packages/web/src/components/DevDiary.tsx
cd $ST/packages/web
NEXT_TELEMETRY_DISABLED=1 HIRAIA_DB_PATH=$ST/fixture.db pnpm build > $ST/build.log 2>&1 || { tail -40 $ST/build.log; exit 1; }
mkdir -p $ST/generated-widget-not-selected
mv public/donate-widget $ST/generated-widget-not-selected/
cp -a $LIVE/packages/web/public/donate-widget public/donate-widget
diff -rq $LIVE/packages/web/public public > $ST/public-diff.txt || true
test ! -s $ST/public-diff.txt
diff -rq $LIVE/packages/web/src src > $ST/src-diff.txt || true
test "$(cat $ST/src-diff.txt)" = "Files $LIVE/packages/web/src/components/DevDiary.tsx and src/components/DevDiary.tsx differ"
grep -q "Fifth pilot launched at Siay National High School, Zamboanga Sibugay" .next/server/app/index.html
echo "STAGED OK BUILD_ID $(cat .next/BUILD_ID)"
