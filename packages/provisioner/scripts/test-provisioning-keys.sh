#!/bin/bash
# Tests for provisioning-keys against throwaway keys in temporary home folders. Never touches the
# real ~/.hiraia. Run: packages/provisioner/scripts/test-provisioning-keys.sh
set -uo pipefail

TOOL="$(cd "$(dirname "$0")" && pwd -P)/provisioning-keys"
T=$(mktemp -d "${TMPDIR:-/tmp}/provisioning-keys-test.XXXXXX")
T=$(cd "$T" && pwd -P)
# A private TMPDIR, so the tool's staging, scratch and mount folders are this run's alone.
export TMPDIR="$T/tmp/"
mkdir -p "$TMPDIR"
PASSWORD='correct horse battery staple 42'
STOREPASS='store-pass-9f2c61'
FAKES=""
passed=0 failed=0

JAVA_DIR=""
for candidate in "${JAVA_HOME:-}/bin" /opt/homebrew/opt/openjdk@17/bin /opt/homebrew/opt/openjdk/bin \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin"; do
  [ -x "$candidate/keytool" ] && { JAVA_DIR=$candidate; break; }
done
[ -n "$JAVA_DIR" ] || { echo "these tests need a JDK"; exit 1; }
PY=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  [ -x "$candidate" ] && { PY=$candidate; break; }
done
[ -n "$PY" ] || { echo "these tests need python3"; exit 1; }

our_devices() {
  hdiutil info 2>/dev/null | awk -v t="$T/" '/^image-path/ {mine = index($0, t) > 0} mine && /^\/dev\/disk[0-9]+[[:space:]]/ {print $1}'
}
finish() {
  local pid dev
  for pid in $FAKES; do kill "$pid" 2>/dev/null; done
  for dev in $(our_devices); do hdiutil detach "$dev" -force -quiet 2>/dev/null; done
  rm -rf "$T"
}
trap finish EXIT

ok() { passed=$((passed + 1)); echo "ok   $1"; }
not_ok() { failed=$((failed + 1)); echo "FAIL $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     /'; }
check() { # DESCRIPTION COMMAND...: the command must succeed
  local description=$1; shift
  if "$@"; then ok "$description"; else not_ok "$description" "${OUT:-}"; fi
}
expect_out() { # DESCRIPTION WANT-STATUS(0|nonzero) TEXT...: $STATUS, and every TEXT in $OUT
  local description=$1 want=$2 text; shift 2
  if [ "$want" = 0 ] && [ "$STATUS" -ne 0 ]; then not_ok "$description (status $STATUS)" "$OUT"; return; fi
  if [ "$want" != 0 ] && [ "$STATUS" -eq 0 ]; then not_ok "$description (succeeded)" "$OUT"; return; fi
  for text in "$@"; do
    case "$OUT" in *"$text"*) ;; *) not_ok "$description (no \"$text\")" "$OUT"; return ;; esac
  done
  ok "$description"
}
lacks() { case "$OUT" in *"$1"*) return 1 ;; esac; return 0; }

# One issued-ID log line as the server writes it: the number, a tab, then the rest.
issued_line() { printf '%s\tHI2609-%s\t2026-09-26T08:35:26+00:00\n' "$1" "$1"; }

# A home folder with a complete, valid set of provisioning keys: 3 phones registered.
make_home() {
  local keys="$1/.hiraia/provisioner-keys" data="$1/.hiraia/provisioning"
  mkdir -p "$keys" "$data"
  "$JAVA_DIR/keytool" -genkeypair -keystore "$keys/provisioner.jks" -storetype PKCS12 -storepass "$STOREPASS" \
    -keypass "$STOREPASS" -alias hiraia-setup -dname CN=test -keyalg RSA -keysize 2048 -validity 2 >/dev/null 2>&1
  printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=hiraia-setup\nkeyPassword=%s\n' \
    "$keys/provisioner.jks" "$STOREPASS" "$STOREPASS" > "$keys/keystore.properties"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$data/tls-key.pem" \
    -out "$data/tls-cert.pem" -days 2 -subj /CN=test >/dev/null 2>&1
  printf 'token-secret-%s\n' "$RANDOM$RANDOM" > "$data/token"
  printf 'receipt-secret-%s\n' "$RANDOM$RANDOM" > "$data/receipt-key"
  printf '192.168.1.10\n' > "$data/host"
  sqlite3 "$data/provisioning.db" "CREATE TABLE devices (seq INTEGER PRIMARY KEY, hiraia_id TEXT, secret_sha256 TEXT);
    INSERT INTO devices VALUES (201, 'HI2609-201', 'aa'), (202, 'HI2609-202', 'bb'), (203, 'HI2609-203', 'cc');"
  { issued_line 201; issued_line 202; issued_line 203; } > "$data/issued.log"
  cp "$data/issued.log" "$1/.hiraia/provisioning.issued.log"
  chmod -R go-rwx "$1/.hiraia"
}

run() { # HOME ARGS...: password on stdin; output in $OUT, status in $STATUS
  local home=$1; shift
  OUT=$(printf '%s\n' "$PASSWORD" | HOME="$home" "$TOOL" "$@" 2>&1); STATUS=$?
}
run_with() { # PASSWORD HOME ARGS...
  local password=$1 home=$2; shift 2
  OUT=$(printf '%s\n' "$password" | HOME="$home" "$TOOL" "$@" 2>&1); STATUS=$?
}

no_secrets() { # HOME whose secrets must not appear in $OUT
  local secret
  for secret in "$PASSWORD" "$STOREPASS" "$(cat "$1/.hiraia/provisioning/token")" "$(cat "$1/.hiraia/provisioning/receipt-key")"; do
    case "$OUT" in *"$secret"*) return 1 ;; esac
  done
  return 0
}

phones() { sqlite3 "$1/.hiraia/provisioning/provisioning.db" 'SELECT count(*) FROM devices;' 2>/dev/null; }

same_tree() { # A-HOME B-HOME: every backed-up file identical in B, with private permissions
  local a=$1 b=$2 rel
  for rel in provisioner-keys/provisioner.jks provisioning/tls-key.pem provisioning/tls-cert.pem provisioning/token \
      provisioning/receipt-key provisioning/issued.log provisioning/host provisioning.issued.log; do
    cmp -s "$a/.hiraia/$rel" "$b/.hiraia/$rel" || { OUT="differs: $rel"; return 1; }
    [ "$(stat -f %Lp "$b/.hiraia/$rel")" = 600 ] || { OUT="mode of $rel: $(stat -f %Lp "$b/.hiraia/$rel")"; return 1; }
  done
  [ "$(stat -f %Lp "$b/.hiraia/provisioner-keys/keystore.properties")" = 600 ] || { OUT="mode of keystore.properties"; return 1; }
  [ "$(grep -v '^storeFile=' "$b/.hiraia/provisioner-keys/keystore.properties")" = \
    "$(grep -v '^storeFile=' "$a/.hiraia/provisioner-keys/keystore.properties")" ] || { OUT="keystore.properties differs"; return 1; }
  [ "$(sqlite3 "$b/.hiraia/provisioning/provisioning.db" 'SELECT group_concat(hiraia_id) FROM devices;')" = \
    "$(sqlite3 "$a/.hiraia/provisioning/provisioning.db" 'SELECT group_concat(hiraia_id) FROM devices;')" ] || { OUT="registry differs"; return 1; }
  [ "$(stat -f %Lp "$b/.hiraia/provisioning")" = 700 ] && [ "$(stat -f %Lp "$b/.hiraia/provisioner-keys")" = 700 ] &&
    [ "$(stat -f %Lp "$b/.hiraia")" = 700 ]
}

nothing_left_open() { [ -z "$(our_devices)" ]; }
nothing_left_in_tmp() { # names what is left, on stderr
  local left
  left=$(ls "$TMPDIR" | grep provisioning-keys || true)
  [ -z "$left" ] || { echo "     left: $left" >&2; return 1; }
}

fake_server() { # HOME DIR ARGS...: a python process that looks like a provisioning server
  local home=$1 dir=$2; shift 2
  (cd "$dir" && HOME="$home" exec "$PY" -c 'import time; time.sleep(120)' "$@") &
  FAKES="$FAKES $!"
  LAST_FAKE=$!
  sleep 1
}
stop_fake() { kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; }

A="$T/a"; make_home "$A"

# ---------------------------------------------------------------------------------------------
echo "# list"
run "$A" list
expect_out "list passes on a complete set" 0 "unlocks with its saved passwords" "3 phones (HI2609-201 to HI2609-203)" "TLS key matches"
check "list prints no secret" no_secrets "$A"
check "a registry that matches its logs raises no warning" lacks "the issued-ID logs go up to"
OUT=$(HOME="$A" HIRAIA_JAVA=none "$TOOL" list 2>&1); STATUS=$?
expect_out "without Java the key is reported unopened, not failed" 0 "not opened (no Java on this Mac)"
# A JAVA_HOME that cannot run the check (a JDK 8, say) does not stop the JDK after it from checking.
mkdir -p "$T/jdk8/bin"; printf '#!/bin/sh\necho "Error: Could not find or load main class $1" >&2\nexit 1\n' > "$T/jdk8/bin/java"; chmod +x "$T/jdk8/bin/java"
OUT=$(HOME="$A" JAVA_HOME="$T/jdk8" "$TOOL" list 2>&1); STATUS=$?
expect_out "a java that cannot run the check is passed over for the next" 0 "unlocks with its saved passwords"
run "$A" backup --choose-password "$T/x.dmg"
check "there is no --choose-password: backups use the password the tool makes" [ "$STATUS" -eq 2 ]

# ---------------------------------------------------------------------------------------------
echo "# backup"
run "$A" backup "$T/keys.dmg"
expect_out "backup makes and checks the image" 0 "every checksum matches" "phone registry: 3 phones" "Backed up and checked"
cp -Rp "$A" "$T/a-at-backup"  # what the image should hold; A changes below
check "backup prints no secret" no_secrets "$A"
check "the image is encrypted" sh -c "hdiutil isencrypted '$T/keys.dmg' 2>&1 | grep -q 'encrypted: YES'"
check "the image is private to its owner" [ "$(stat -f %Lp "$T/keys.dmg")" = 600 ]
check "backup leaves nothing open" nothing_left_open
check "backup leaves no staging copy of the keys" nothing_left_in_tmp
check "backup leaves no half-made image" sh -c "! ls -a '$T' | grep -q partial"
expect_out "backup ends with a verify command that works from anywhere" 0 "bash \"$TOOL\" verify \"$T/keys.dmg\""
run "$A" backup "$T/keys.dmg"
expect_out "backup never overwrites an existing file" nonzero "already exists"
mkdir "$T/readonly"; chmod 500 "$T/readonly"
OUT=$(HOME="$A" "$TOOL" backup "$T/readonly/k.dmg" </dev/null 2>&1); STATUS=$?
expect_out "backup refuses an unwritable folder before asking for a password" nonzero "can't write to"
run "$A" backup "$T/nowhere/k.dmg"
expect_out "backup refuses a folder that does not exist" nonzero "no such folder"
run_with short "$A" backup "$T/short.dmg"
expect_out "backup refuses a short password" nonzero "at least 20 characters"
run_with aaaaaaaaaaaaaaaaaaaaaaaaaaaa "$A" backup "$T/weak.dmg"
expect_out "backup refuses a long password of few characters" nonzero "too few characters"
check "refused backups make no image" sh -c "[ ! -e '$T/short.dmg' ] && [ ! -e '$T/weak.dmg' ]"

# The backup password is never in the environment of anything the tool runs, even when the calling
# shell exports a variable of the same name.
mkdir -p "$T/spy"
printf '#!/bin/sh\nenv >> "%s/spy/env"\nexec "%s/java" "$@"\n' "$T" "$JAVA_DIR" > "$T/spy/java"; chmod +x "$T/spy/java"
OUT=$(printf '%s\n' "$PASSWORD" | HOME="$A" HIRAIA_JAVA="$T/spy/java" HK_SECRET=inherited HK_FIRST=inherited PASSWORD=inherited \
  "$TOOL" backup "$T/spied.dmg" 2>&1); STATUS=$?
expect_out "(a backup with an inherited HK_SECRET)" 0 "Backed up and checked"
check "the backup password never reaches a child's environment" sh -c "[ -s '$T/spy/env' ] && ! grep -qF '$PASSWORD' '$T/spy/env'"

# The interactive path: a password made up, shown once, saved, taken off the screen, then asked for.
cat > "$T/generated.exp" <<'EOF'
set timeout 240
log_user 0
spawn [lindex $argv 0] backup [lindex $argv 1]
expect {
  -re {nothing else can open the backup:\r\n\r\n    ([a-z]+(-[a-z]+){5})\r\n} { set pw $expect_out(1,string) }
  timeout { puts "no password shown"; exit 2 }
  eof { puts "ended before showing a password"; exit 2 }
}
expect {
  "as a new item named \"Hiraia provisioning keys - generated.dmg\"" {}
  timeout { puts "no password-manager item named after the file"; exit 2 }
}
expect {
  "Press Enter once it is saved: " {}
  timeout { puts "no pause to save it"; exit 2 }
}
send "\r"
expect {
  -re {\x1b\[3J} {}
  timeout { puts "the screen was not cleared"; exit 3 }
  eof { puts "ended before clearing the screen"; exit 3 }
}
expect {
  "confirm: " {}
  timeout { puts "no confirmation prompt"; exit 3 }
}
send "not-the-password\r"
expect {
  "doesn't match" {}
  "Password confirmed" { puts "a wrong confirmation was accepted"; exit 4 }
  timeout { puts "no answer to a wrong confirmation"; exit 4 }
  eof { puts "ended after one wrong confirmation"; exit 4 }
}
expect {
  "confirm: " {}
  timeout { puts "no second confirmation prompt"; exit 4 }
}
send "$pw\r"
expect {
  "Backed up and checked" {}
  timeout { puts "no backup"; exit 5 }
  eof { puts "ended without a backup"; exit 5 }
}
expect eof
puts $pw
exit 0
EOF
GENERATED=$(HOME="$A" expect "$T/generated.exp" "$TOOL" "$T/generated.dmg" 2>&1); STATUS=$?
if [ $STATUS -eq 0 ] && printf '%s' "$GENERATED" | tr -d '\r' | grep -Eqx '[a-z]+(-[a-z]+){5}'; then
  ok "backup shows a six-word password once, waits for it to be saved, clears it and asks for it back"
  run_with "$(printf '%s' "$GENERATED" | tr -d '\r')" "$A" verify "$T/generated.dmg"
  expect_out "the generated password opens its backup" 0 "The backup is good."
else
  not_ok "backup shows a six-word password once, waits for it to be saved, clears it and asks for it back" "$GENERATED"
fi
cat > "$T/unconfirmed.exp" <<'EOF'
set timeout 120
log_user 0
spawn [lindex $argv 0] backup [lindex $argv 1]
expect {
  "Press Enter once it is saved: " {}
  timeout { exit 2 }
}
send "\r"
foreach attempt {1 2 3} {
  expect {
    "confirm: " {}
    timeout { exit 3 }
  }
  send "wrong guess $attempt\r"
}
expect {
  "nothing was backed up" { exit 0 }
  "Backed up and checked" { exit 4 }
  timeout { exit 5 }
  eof { exit 6 }
}
exit 7
EOF
HOME="$A" expect "$T/unconfirmed.exp" "$TOOL" "$T/unconfirmed.dmg" >/dev/null 2>&1; STATUS=$?
check "three wrong confirmations end the backup, making nothing" sh -c "[ $STATUS -eq 0 ] && [ ! -e '$T/unconfirmed.dmg' ] && ! ls -a '$T' | grep -q partial"
# Ctrl-C at the hidden prompt gives the terminal its echo back, even in bash.
cat > "$T/interrupt.exp" <<'EOF'
set timeout 180
log_user 0
spawn /bin/bash --norc --noprofile -i
send "PS1='READY> '\r"
expect {
  "READY> " {}
  timeout { exit 2 }
}
send "[lindex $argv 0] verify [lindex $argv 1]\r"
expect {
  "Password for" {}
  timeout { exit 3 }
}
send "\003"
expect {
  "READY> " {}
  timeout { exit 4 }
}
send "stty -a | tr ' ' '\\n' | grep -x -e echo -e -echo\r"
expect {
  -re {\r\n-echo\r\n} { exit 1 }
  -re {\r\necho\r\n} { exit 0 }
  timeout { exit 5 }
}
exit 6
EOF
HOME="$A" expect "$T/interrupt.exp" "$TOOL" "$T/keys.dmg" >/dev/null 2>&1; STATUS=$?
check "Ctrl-C at the password prompt leaves the terminal echoing" [ $STATUS -eq 0 ]

# Interrupted while the image is being made (Ctrl-C, Ctrl-\): no plain copies, no image, no half-made file.
# A job started in the background ignores both signals from birth, as a shell script would; perl
# gives them back their usual effect, as a Terminal does for a command typed into it.
BIG="$T/big"; make_home "$BIG"; dd if=/dev/urandom of="$BIG/.hiraia/provisioning/bulk" bs=1m count=200 2>/dev/null
for signal in INT QUIT; do
  (printf '%s\n' "$PASSWORD" | HOME="$BIG" perl -e '$SIG{INT} = $SIG{QUIT} = "DEFAULT"; exec @ARGV or die' -- \
    "$TOOL" backup "$T/interrupted-$signal.dmg" >/dev/null 2>&1; echo $? > "$T/interrupted-$signal.status") &
  runner=$!
  creator=""
  for i in $(seq 1 600); do
    creator=$(pgrep -f "hdiutil create -srcfolder $TMPDIR" | head -1)
    [ -n "$creator" ] && break
    sleep 0.1
  done
  kill -"$signal" "$(ps -o ppid= -p "$creator" | tr -d ' ')" 2>/dev/null; wait "$runner" 2>/dev/null
  check "Ctrl-$signal while the image is made stops the backup" [ "$(cat "$T/interrupted-$signal.status")" -ge 129 ]
  # An hdiutil left running would finish the image after the tool had gone: wait it out.
  for i in $(seq 1 1200); do pgrep -f "hdiutil create -srcfolder $TMPDIR" >/dev/null || break; sleep 0.1; done
  check "Ctrl-$signal while the image is made leaves no plain copy of the keys" sh -c "! ls '$TMPDIR' | grep -q '^provisioning-keys\.'"
  check "... and no image or half-made image" sh -c "[ ! -e '$T/interrupted-$signal.dmg' ] && ! ls -a '$T' | grep -q 'interrupted-$signal.partial'"
done
check "(nothing left open after the interruptions)" nothing_left_open

# Two backups racing for one file name: the one that finishes second keeps the first's file.
mkfifo "$T/late-password"
exec 3<>"$T/late-password"  # held open, so the first run starts and waits at its password
(HOME="$A" "$TOOL" backup "$T/race.dmg" < "$T/late-password" > "$T/race-first.out" 2>&1; echo $? > "$T/race-first.status") &
racer=$!
sleep 2
run "$A" backup "$T/race.dmg"
expect_out "(the other run makes race.dmg meanwhile)" 0 "Backed up and checked"
winner=$(shasum -a 256 "$T/race.dmg" | cut -d' ' -f1)
printf '%s\n' "$PASSWORD" >&3; wait "$racer"; exec 3>&-
OUT=$(cat "$T/race-first.out"); STATUS=$(cat "$T/race-first.status")
expect_out "a run whose file appeared meanwhile gives up" nonzero "appeared while this ran"
check "... and leaves the other run's backup as it was" [ "$(shasum -a 256 "$T/race.dmg" | cut -d' ' -f1)" = "$winner" ]

# ---------------------------------------------------------------------------------------------
echo "# verify"
run "$A" verify "$T/keys.dmg"
expect_out "verify accepts a good backup" 0 "The backup is good."
run_with "wrong password entirely" "$A" verify "$T/keys.dmg"
expect_out "verify says so when the password is wrong" nonzero "wrong password"
issued_line 204 >> "$A/.hiraia/provisioning/issued.log"
sqlite3 "$A/.hiraia/provisioning/provisioning.db" "INSERT INTO devices VALUES (204, 'HI2609-204', 'dd');"
run "$A" verify "$T/keys.dmg"
expect_out "verify reports a registry and log that grew since" 0 "3 phones in the backup, 4 on this Mac" "issued.log has grown since the backup"
grep -v HI2609-202 "$A/.hiraia/provisioning.issued.log" > "$T/log" && cat "$T/log" > "$A/.hiraia/provisioning.issued.log"
run "$A" verify "$T/keys.dmg"
expect_out "verify reports a log that lost lines" 0 "provisioning.issued.log on this Mac lacks 1 of the backup's lines"
cp "$T/a-at-backup/.hiraia/provisioning.issued.log" "$A/.hiraia/provisioning.issued.log"

# Opened in Finder already: used where it is, and left open, however its path is spelled.
mkdir -p "$T/finder"
printf '%s' "$PASSWORD" | hdiutil attach "$T/keys.dmg" -stdinpass -readonly -nobrowse -noautoopen -mountpoint "$T/finder" >/dev/null
OUT=$(HOME="$A" "$TOOL" verify "$T/keys.dmg" </dev/null 2>&1); STATUS=$?
expect_out "verify of a backup already open uses it, without a password" 0 "already open at" "The backup is good."
check "and leaves it open" sh -c "mount | grep -qF ' on $T/finder '"
ln -s "$T/keys.dmg" "$T/link.dmg"
OUT=$(HOME="$A" "$TOOL" verify "$T/link.dmg" </dev/null 2>&1); STATUS=$?
expect_out "the open backup is recognised through a symlink too" 0 "already open at"
run "$A" verify "$T/finder"
expect_out "verify takes the folder it is open at" 0 "The backup is good."
cp -R "$T/finder" "$T/copy"; chmod -R u+w "$T/copy"
hdiutil detach "$T/finder" -quiet
# Open in another run of the tool: not read from under it.
mkdir -p "${TMPDIR}provisioning-keys-mount.other"
printf '%s' "$PASSWORD" | hdiutil attach "$T/keys.dmg" -stdinpass -readonly -nobrowse -noautoopen -mountpoint "${TMPDIR}provisioning-keys-mount.other" >/dev/null
OUT=$(HOME="$A" "$TOOL" verify "$T/keys.dmg" </dev/null 2>&1); STATUS=$?
expect_out "a backup another run has open is left to it" nonzero "another provisioning-keys run has keys.dmg open"
hdiutil detach "${TMPDIR}provisioning-keys-mount.other" -quiet; rmdir "${TMPDIR}provisioning-keys-mount.other"
# Attached but mounted nowhere (an interrupted open), with a detach that fails: a message, not silence.
printf '%s' "$PASSWORD" | hdiutil attach "$T/keys.dmg" -stdinpass -readonly -nomount >/dev/null
mkdir -p "$T/shim"
printf '#!/bin/sh\nif [ "$1" = detach ]; then echo "hdiutil: couldn'"'"'t eject - Resource busy" >&2; exit 16; fi\nexec /usr/bin/hdiutil "$@"\n' > "$T/shim/hdiutil"; chmod +x "$T/shim/hdiutil"
OUT=$(printf '%s\n' "$PASSWORD" | HOME="$A" PATH="$T/shim:$PATH" "$TOOL" verify "$T/keys.dmg" 2>&1); STATUS=$?
expect_out "a stuck leftover that will not detach does not end the run in silence" 0 "The backup is good."
for dev in $(our_devices); do hdiutil detach "$dev" -force -quiet 2>/dev/null; done
for dir in "$TMPDIR"provisioning-keys-mount.*; do [ -d "$dir" ] && rmdir "$dir" 2>/dev/null; done

printf 'x' >> "$T/copy/hiraia/provisioning/token"
run "$A" verify "$T/copy"
expect_out "verify catches a changed file" nonzero "provisioning/token does not match"
cp "$T/a-at-backup/.hiraia/provisioning/token" "$T/copy/hiraia/provisioning/token"
touch "$T/copy/hiraia/provisioning/.DS_Store" "$T/copy/hiraia/._token"
run "$A" verify "$T/copy"
expect_out "Finder's own files are not held against a backup" 0 "The backup is good."
printf 'x' > "$T/copy/hiraia/provisioning/extra"
run "$A" verify "$T/copy"
expect_out "verify names a file the manifest does not list" nonzero "does not list: provisioning/extra"
rm "$T/copy/hiraia/provisioning/extra"
mkdir -p "$T/plain/src" && echo x > "$T/plain/src/a"
hdiutil create -srcfolder "$T/plain/src" -format UDZO "$T/plain.dmg" >/dev/null 2>&1
run "$A" verify "$T/plain.dmg"
expect_out "verify refuses an image that is not encrypted" nonzero "not encrypted"
check "verify leaves nothing open" nothing_left_open

# ---------------------------------------------------------------------------------------------
echo "# restore"
B="$T/b"; mkdir -p "$B"
run "$B" restore "$T/keys.dmg"
expect_out "restore into an empty home" 0 "+ provisioner-keys/provisioner.jks" "Restored."
check "restored files are identical and private" same_tree "$T/a-at-backup" "$B"
expect_out "a restore under another home points storeFile at this home's key" 0 "storeFile now names this Mac's provisioner.jks"
check "(it does)" grep -qx "storeFile=$B/.hiraia/provisioner-keys/provisioner.jks" "$B/.hiraia/provisioner-keys/keystore.properties"
run "$B" list
expect_out "the restored set checks out, with no storeFile warning" 0 "unlocks with its saved passwords" "3 phones"
check "(no warning)" lacks "another Mac's path"
run "$B" restore "$T/keys.dmg"
expect_out "restore again changes nothing" 0 "= provisioning/token already in place" "already in place (its storeFile names this Mac's key)" "Restored."

# keystore.properties copied by hand from another Mac: list says how to fix it.
cp "$B/.hiraia/provisioner-keys/keystore.properties" "$T/b-properties"
sed -i '' "s|^storeFile=.*|storeFile=/Users/someone/.hiraia/provisioner-keys/provisioner.jks|" "$B/.hiraia/provisioner-keys/keystore.properties"
run "$B" list
expect_out "list explains a storeFile naming another Mac's home" 0 "names another Mac's path" "sed -i ''"
cp "$T/b-properties" "$B/.hiraia/provisioner-keys/keystore.properties"

# A missing file comes back even while another differs; the differing one waits for --force.
rm "$B/.hiraia/provisioner-keys/provisioner.jks"
printf 'a different token\n' > "$B/.hiraia/provisioning/token"
run "$B" restore "$T/keys.dmg"
expect_out "restore puts back a missing file and leaves a differing one" nonzero "+ provisioner-keys/provisioner.jks" "Left as they are" "provisioning/token" "--force" "not finished"
check "the differing file is untouched" [ "$(cat "$B/.hiraia/provisioning/token")" = "a different token" ]
check "the missing file is back" cmp -s "$B/.hiraia/provisioner-keys/provisioner.jks" "$T/a-at-backup/.hiraia/provisioner-keys/provisioner.jks"
run "$B" restore --force "$T/keys.dmg"
expect_out "restore --force" 0 "provisioning/token: the old one is now token.replaced-" "Restored."
check "--force sets the old file aside" sh -c "cat '$B'/.hiraia/provisioning/token.replaced-* | grep -q 'a different token'"
check "--force puts the backup's file in place" cmp -s "$B/.hiraia/provisioning/token" "$T/a-at-backup/.hiraia/provisioning/token"
check "no half-written copy is left beside anything" sh -c "! find '$B/.hiraia' -name '*.restoring.*' | grep -q ."

# The issued-ID logs are merged, never shortened, whatever the flags: no ID is issued twice.
{ issued_line 204; issued_line 205; } >> "$B/.hiraia/provisioning/issued.log"
grep -v HI2609-202 "$B/.hiraia/provisioning.issued.log" > "$T/log"; printf '%s' "$(cat "$T/log")" > "$B/.hiraia/provisioning.issued.log"
sqlite3 "$B/.hiraia/provisioning/provisioning.db" "INSERT INTO devices VALUES (204, 'HI2609-204', 'dd'), (205, 'HI2609-205', 'ee');"
run "$B" restore --force "$T/keys.dmg"
expect_out "restore merges the issued-ID logs" 0 "provisioning.issued.log: merged in 1 line(s)" "provisioning/issued.log: this Mac's already has every line"
check "a newer log keeps its newer lines" grep -q HI2609-205 "$B/.hiraia/provisioning/issued.log"
check "a damaged log gets the backup's lines back, on lines of their own" sh -c "[ \"\$(grep -c HI2609 '$B/.hiraia/provisioning.issued.log')\" = 3 ] && grep -q '^202	HI2609-202' '$B/.hiraia/provisioning.issued.log'"
check "no log is ever set aside and replaced" sh -c "! ls '$B'/.hiraia/provisioning/issued.log.replaced-* '$B'/.hiraia/provisioning.issued.log.replaced-* 2>/dev/null | grep -q ."

# A registry ahead of the backup's is kept; the host file is always this Mac's.
printf '10.0.0.99\n' > "$B/.hiraia/provisioning/host"
run "$B" restore "$T/keys.dmg"
expect_out "restore keeps a registry ahead of the backup's" 0 "kept this Mac's registry (5 phones, up to number 205; the backup's has 3, up to 203)" "--replace-registry" "host: kept this Mac's"
check "the kept registry still has its 5 phones" [ "$(phones "$B")" = 5 ]
check "the host file is this Mac's" [ "$(cat "$B/.hiraia/provisioning/host")" = 10.0.0.99 ]
run "$B" restore --replace-registry "$T/keys.dmg"
expect_out "restore --replace-registry uses the backup's, counting both right" 0 "the backup's registry (3 phones) replaced this Mac's (5 phones)"
set_aside_db=$(ls "$B"/.hiraia/provisioning/provisioning.db.replaced-* 2>/dev/null | grep -Ev -- '-(wal|shm|journal)$' | tail -1)
check "the replaced registry is kept aside, whole" [ "$(sqlite3 "$set_aside_db" 'SELECT count(*) FROM devices;' 2>/dev/null)" = 5 ]
# Behind the backup's: left alone, and the run fails until a choice is made.
sqlite3 "$B/.hiraia/provisioning/provisioning.db" "DELETE FROM devices WHERE seq = 203;"
run "$B" restore "$T/keys.dmg"
expect_out "restore will not quietly keep a registry behind the backup's" nonzero "The registry was left as it is" "2 phones up to number 202" "--replace-registry"
check "(it is left as it was)" [ "$(phones "$B")" = 2 ]
# Empty, as on a new Mac where the server ran once before the restore: replaced.
sqlite3 "$B/.hiraia/provisioning/provisioning.db" "DELETE FROM devices;"
run "$B" restore "$T/keys.dmg"
expect_out "restore replaces an empty registry with the backup's" 0 "the backup's registry (3 phones) replaced this Mac's (0 phones)" "Restored."
check "(3 phones)" [ "$(phones "$B")" = 3 ]

# SQLite side files beside the registry go aside with it, so none is replayed into the restored one.
make_wal() { # DB: leaves a committed but uncheckpointed write in DB-wal, as a crashed process would
  "$PY" - "$1" <<'EOF'
import os, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA wal_autocheckpoint=0")
db.execute("DELETE FROM devices")
db.execute("INSERT INTO devices VALUES (1, 'HI-STALE-1', 'zz')")
db.commit()
os._exit(0)
EOF
}
make_wal "$B/.hiraia/provisioning/provisioning.db"
check "(the stale write sits in a -wal file)" [ -s "$B/.hiraia/provisioning/provisioning.db-wal" ]
run "$B" restore --replace-registry "$T/keys.dmg"
expect_out "restore --replace-registry beside a -wal" 0 "the backup's registry (3 phones)"
check "the restored registry is the backup's, not the -wal's" [ "$(phones "$B")" = 3 ]
check "no side file is left beside it" sh -c "! ls '$B'/.hiraia/provisioning/provisioning.db-* 2>/dev/null | grep -q ."
make_wal "$B/.hiraia/provisioning/provisioning.db"
rm "$B/.hiraia/provisioning/provisioning.db"
run "$B" restore "$T/keys.dmg"
check "a registry that is gone comes back without its orphaned -wal" sh -c "[ $STATUS -eq 0 ] && [ \"\$(sqlite3 '$B/.hiraia/provisioning/provisioning.db' 'SELECT count(*) FROM devices;')\" = 3 ] && [ ! -e '$B/.hiraia/provisioning/provisioning.db-wal' ]"

# A restore that fails part-way (here, a folder it may not write in) leaves what was there, says
# where it stopped, and leaves no debris.
cp -R "$T/copy" "$T/unreadable"; chmod -R u+w "$T/unreadable"; chmod 000 "$T/unreadable/hiraia/provisioning/receipt-key"
run "$B" restore --force "$T/unreadable"
expect_out "a backup whose files can't be read is refused before anything changes" nonzero "nothing was restored"
printf 'the old receipt key\n' > "$B/.hiraia/provisioning/receipt-key"
chflags uchg "$B/.hiraia/provisioning"
run "$B" restore --force "$T/keys.dmg"
chflags nouchg "$B/.hiraia/provisioning"
expect_out "a restore that fails part-way says where it stopped" nonzero "the restore stopped at provisioning/receipt-key" "Nothing was lost"
check "... the file it was replacing is still there, unchanged" [ "$(cat "$B/.hiraia/provisioning/receipt-key")" = "the old receipt key" ]
check "... and nothing half-written is left" sh -c "! find '$B/.hiraia' -name '*.restoring.*' | grep -q ."
run "$B" restore --force "$T/keys.dmg"
expect_out "(and the next restore finishes)" 0 "Restored."

# A disk that fills part-way through a copy leaves the file being replaced where it was.
hdiutil create -size 4m -fs HFS+ -volname small "$T/small.dmg" >/dev/null 2>&1
mkdir -p "$T/small"; hdiutil attach "$T/small.dmg" -nobrowse -noautoopen -mountpoint "$T/small" >/dev/null
run "$T/small" restore "$T/keys.dmg"
expect_out "(a restore onto a small disk)" 0 "Restored."
sqlite3 "$T/small/.hiraia/provisioning/provisioning.db" "INSERT INTO devices VALUES (204, 'HI2609-204', 'dd');"
dd if=/dev/zero of="$T/small/filler" bs=64k 2>/dev/null; dd if=/dev/zero of="$T/small/filler2" bs=512 2>/dev/null
check "(the small disk is full)" [ "$(df -k "$T/small" | awk 'NR == 2 {print $4}')" -eq 0 ]
run "$T/small" restore --replace-registry "$T/keys.dmg"
expect_out "a restore on a full disk stops, saying where" nonzero "the restore stopped at provisioning/provisioning.db"
check "... and the registry it was replacing is still in place, whole" [ "$(phones "$T/small")" = 4 ]
hdiutil detach "$T/small" -force -quiet

# A restore under a running server for this home is refused, naming it; others are no obstacle.
mkdir -p "$T/repo/packages/provisioner/server"
fake_server "$B" "$T/repo" packages/provisioner/server/server.py
run "$B" restore "$T/keys.dmg"
expect_out "restore refuses while this home's server runs, and names it" nonzero "stop the provisioning server first" "$LAST_FAKE"
C="$T/c"; mkdir -p "$C"
run "$C" restore "$T/keys.dmg"
expect_out "another home's server does not block a restore" 0 "Restored."
stop_fake "$LAST_FAKE"
C2="$T/c2"; mkdir -p "$C2"
fake_server "$C2" "$T/repo/packages/provisioner/server" ./server.py
run "$C2" restore "$T/keys.dmg"
expect_out "a server started as ./server.py is found too" nonzero "stop the provisioning server first"
stop_fake "$LAST_FAKE"
touch "$T/repo/packages/provisioner/server/server.py"
(cd "$T/repo" && HOME="$C2" exec tail -f packages/provisioner/server/server.py) & FAKES="$FAKES $!"; TAILER=$!; sleep 1
check "(the stand-in is running)" kill -0 "$TAILER"
run "$C2" restore "$T/keys.dmg"
expect_out "a program that merely names server.py is not a server" 0 "Restored."
kill "$TAILER" 2>/dev/null
C3="$T/c3"; mkdir -p "$C3" "$T/other-project"
fake_server "$C3" "$T/other-project" server.py
run "$C3" restore "$T/keys.dmg"
expect_out "another project's server.py is not the provisioning server" 0 "Restored."
stop_fake "$LAST_FAKE"

# A running server's warning survives to the end of a backup.
fake_server "$A" "$T/repo" packages/provisioner/server/server.py
run "$A" backup "$T/while-serving.dmg"
expect_out "a backup taken while the server runs says so at the end too" 0 "The provisioning server was running, so phones that register from now on are not in this backup"
stop_fake "$LAST_FAKE"

# ---------------------------------------------------------------------------------------------
echo "# broken sets"
D="$T/d"; make_home "$D"; rm "$D/.hiraia/provisioning/receipt-key"
run "$D" backup "$T/incomplete.dmg"
expect_out "backup refuses a missing file" nonzero "missing: provisioning/receipt-key"
check "(and makes no image)" [ ! -e "$T/incomplete.dmg" ]
E="$T/e"; make_home "$E"; openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:prime256v1 -out "$E/.hiraia/provisioning/tls-key.pem" 2>/dev/null
run "$E" list
expect_out "list catches a TLS key that is not the certificate's" nonzero "tls-key.pem does not match tls-cert.pem"
F="$T/f"; make_home "$F"; P="$F/.hiraia/provisioner-keys/keystore.properties"
sed -i '' 's/^storePassword=.*/storePassword=not-the-store-password/' "$P"
run "$F" list
expect_out "list catches a storePassword that does not open the keystore" nonzero "does not open with the storePassword"
check "and prints no password" lacks not-the-store-password
sed -i '' "s/^storePassword=.*/storePassword=$STOREPASS/; s/^keyPassword=.*/keyPassword=not-the-key-password/" "$P"
run "$F" list
expect_out "list catches a keyPassword that does not unlock the key" nonzero "keyPassword in keystore.properties does not unlock"
OUT=$(HOME="$F" JAVA_HOME="$T/jdk8" "$TOOL" list 2>&1); STATUS=$?
expect_out "... even when JAVA_HOME names a java that cannot run the check" nonzero "does not unlock"
sed -i '' "s/^keyPassword=.*/keyPassword=$STOREPASS/; s/^keyAlias=.*/keyAlias=someone-else/" "$P"
run "$F" list
expect_out "list catches a keyAlias with no key" nonzero "no private key named someone-else"
sed -i '' '/^keyAlias=/d' "$P"
run "$F" list
expect_out "list catches a missing keyAlias" nonzero "has no keyAlias"
printf 'keyAlias=hiraia-setup\n' >> "$P"
cp "$F/.hiraia/provisioner-keys/provisioner.jks" "$T/elsewhere.jks"
sed -i '' "s|^storeFile=.*|storeFile=$T/elsewhere.jks|" "$P"
run "$F" list
expect_out "list catches a storeFile naming a keystore outside the backup" nonzero "signs with $T/elsewhere.jks, not the provisioner.jks beside it"
ln "$F/.hiraia/provisioner-keys/provisioner.jks" "$T/same-key.jks"
sed -i '' "s|^storeFile=.*|storeFile=$T/same-key.jks|" "$P"
run "$F" list
expect_out "... but not one naming the same file by another name" 0 "unlocks with its saved passwords"
sed -i '' 's|^storeFile=.*|storeFile=provisioner.jks|' "$P"
run "$F" list
expect_out "list warns of a relative storeFile" 0 "is relative, which Gradle reads against"
G="$T/g"; make_home "$G"; printf 'not a database' > "$G/.hiraia/provisioning/provisioning.db"
run "$G" list
expect_out "list catches a damaged registry, saying why" nonzero "provisioning.db can't be read" "not a database"
G2="$T/g2"; make_home "$G2"; sqlite3 "$G2/.hiraia/provisioning/provisioning.db" "DELETE FROM devices;"
run "$G2" list
expect_out "list catches an empty registry beside a log of issued IDs" nonzero "it has no phones, yet the issued-ID log records 3 IDs"
G3="$T/g3"; make_home "$G3"; issued_line 250 >> "$G3/.hiraia/provisioning.issued.log"
run "$G3" list
expect_out "list notes IDs issued beyond the registry" 0 "the issued-ID logs go up to number 250, the registry only to 203"
H="$T/h"; make_home "$H"
"$PY" - "$H/.hiraia/provisioning/provisioning.db" <<'EOF'
import os, sqlite3, sys
db = sqlite3.connect(sys.argv[1], isolation_level=None)
db.execute("PRAGMA cache_size=2")
db.execute("CREATE TABLE filler (x TEXT)")
db.execute("BEGIN IMMEDIATE")
for i in range(400):
    db.execute("INSERT INTO filler VALUES (?)", ("x" * 500,))
os._exit(9)
EOF
run "$H" list
expect_out "list explains an unfinished write rather than calling it damage" nonzero "unfinished write beside it"

# A registry in WAL mode, open in another process: the snapshot is still one clean file.
W="$T/w"; make_home "$W"
sqlite3 "$W/.hiraia/provisioning/provisioning.db" 'PRAGMA journal_mode=WAL;' >/dev/null
"$PY" -c 'import sqlite3, sys, time; db = sqlite3.connect(sys.argv[1]); db.execute("SELECT 1 FROM devices").fetchall(); time.sleep(90)' \
  "$W/.hiraia/provisioning/provisioning.db" & HOLDER=$!; FAKES="$FAKES $HOLDER"; sleep 1
run "$W" backup "$T/wal.dmg"
expect_out "backup of a registry in WAL mode" 0 "Backed up and checked" "3 phones"
kill "$HOLDER" 2>/dev/null
W2="$T/w2"; mkdir -p "$W2"
run "$W2" restore "$T/wal.dmg"
expect_out "and it restores" 0 "Restored."

# Plain copies of the keys an interrupted backup left behind are swept away by the next one.
mkdir -p "${TMPDIR}provisioning-keys.OLDRUN/hiraia" && printf 'leftover' > "${TMPDIR}provisioning-keys.OLDRUN/hiraia/token"
touch -t 202001010000 "${TMPDIR}provisioning-keys.OLDRUN"
run "$A" backup "$T/after-crash.dmg"
expect_out "backup sweeps up a staging folder an interrupted run left" 0 "left by an interrupted run"
check "(it is gone)" [ ! -e "${TMPDIR}provisioning-keys.OLDRUN" ]

check "no image is left open at the end" nothing_left_open
check "no staging or scratch folder is left at the end" nothing_left_in_tmp
echo "passed $passed, failed $failed"
[ $failed -eq 0 ]
