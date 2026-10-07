#!/usr/bin/env bash
# Every package on the attached phone, as TSV: the baseline the DPC's keep/remove policy is
# written against. Read-only.
#
#   ANDROID_SERIAL=<serial> packages/provisioner/scripts/package-inventory.sh > inventory.tsv
set -euo pipefail

launcher=$(adb shell cmd package query-activities --brief -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER | sed -n 's#^ *\([^/ ]*\)/.*#\1#p' | sort -u)
disabled=$(adb shell pm list packages -d | sed 's/^package://' | sort -u)
third_party=$(adb shell pm list packages -3 | sed 's/^package://' | sort -u)

echo "# $(adb shell getprop ro.product.model | tr -d '\r') $(adb shell getprop ro.build.display.id | tr -d '\r')," \
  "serial $(adb get-serialno), captured $(date -u +%Y-%m-%dT%H:%MZ)"
printf 'package\tkind\tenabled\tlauncher\tversion\tpath\n'
adb shell pm list packages -f | sed 's/^package://' | tr -d '\r' | sort -t= -k2 | while IFS= read -r line; do
  package=${line##*=}; path=${line%=*}
  kind=system; grep -qx "$package" <<<"$third_party" && kind=preinstalled-user
  enabled=yes; grep -qx "$package" <<<"$disabled" && enabled=no
  visible=no; grep -qx "$package" <<<"$launcher" && visible=yes
  version=$(adb shell dumpsys package "$package" </dev/null | sed -n 's/^ *versionName=//p' | head -1 | tr -d '\r')
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$package" "$kind" "$enabled" "$visible" "$version" "$path"
done
