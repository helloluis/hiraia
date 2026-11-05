# MBP `harvestd` → Hiraia CRM API integration

The Hiraia CRM API is a private, bearer-key-protected surface on hiraia.org that stores the
**extracted** school-pipeline data (contacts, threads, classified summaries) that `harvestd`
derives from Luis's own Messenger/Viber conversations. **Raw message text is never sent** — only
the extracted summaries and metadata. Beaniebot reads the same store for chat queries.

Operations side (install, backups, restore, key rotation): `deploy/crm/README.md`.

## Base URL and transport

| Item | Value |
| --- | --- |
| Base URL | `https://hiraia.org/api/crm` (set `HIRAIA_CRM_BASE_URL`; default to this) |
| Transport | HTTPS only. Plain `http://` redirects at the edge and the service itself refuses non-HTTPS requests (`403 https_required`). |
| Content type | `Content-Type: application/json` on every POST; responses are JSON, `Cache-Control: no-store`. |
| Body limit | 256 KB per request (`413 payload_too_large`); `extracted_json` ≤ 200 KB serialized. |
| Request id | Every response carries `X-Request-Id`; quote it when reporting a problem. |

## Authentication

```
Authorization: Bearer <value of HIRAIA_CRM_API_KEY>
```

- Each client has its own key. `harvestd` on the MBP uses the **mbp-harvestd** key (scope
  `write`, which includes read). Beaniebot uses the **beaniebot** key (scope `read`).
- The MBP service reads the key from the environment variable **`HIRAIA_CRM_API_KEY`**. Load it
  from the macOS Keychain at start-up rather than from a file in the repo:

  ```bash
  # one-time: store the key (prompts for the value; nothing is echoed)
  security add-generic-password -s hiraia-crm -a mbp-harvestd -w
  # at service start
  export HIRAIA_CRM_API_KEY="$(security find-generic-password -s hiraia-crm -a mbp-harvestd -w)"
  export HIRAIA_CRM_BASE_URL="https://hiraia.org/api/crm"
  ```

- Where the value comes from: `deploy/crm/keygen.sh` on the origin writes each client's key once
  to a root-only pickup file (`/root/hiraia-crm-secrets/mbp-harvestd.key`). The server keeps only
  its SHA-256. Pick it up over SSH, load it into the Keychain, then `shred -u` the pickup file.
  Rotation: `/opt/hiraia-crm/keygen.sh mbp-harvestd write --rotate` (the old key stops working
  immediately; update the Keychain entry).
- Keys look like `hcrm_<client>_<43 characters>`. Never log them, never put them in a URL, never
  commit them. This document deliberately contains no key value.
- Failures: `401 unauthorized` (missing/unknown key — stop and alert, do not retry blindly),
  `403 forbidden` (key lacks the scope; `details.scope` says which), `403 https_required`.

## Health check

| Endpoint | Auth | Use |
| --- | --- | --- |
| `GET /api/crm/health` | none | Connectivity probe. `200 {"ok":true}` means nginx → service → database all answer. Poll before a sync run; anything else means hold the batch and retry later. |
| `GET /api/crm/status` | read | Row counts, service version, last backup (`backup.last_ok_at`, `backup.stale`, `backup.offsite`). Beaniebot can surface this. |

```bash
curl -sS "$HIRAIA_CRM_BASE_URL/health"
# {"ok":true}
curl -sS -H "Authorization: Bearer $HIRAIA_CRM_API_KEY" "$HIRAIA_CRM_BASE_URL/status"
# {"ok":true,"version":"1.0.0","uptime_s":1234,"counts":{"contacts":12,"threads":14,"extracts":57,"events":90,"idempotency_keys":57},
#  "migrations":1,"backup":{"last_ok_at":"2026-10-28T19:03:11Z","artifact":"…","offsite":{"state":"ok",…},"stale":false,…}}
```

## Endpoint reference

### `POST /api/crm/contacts` — upsert a contact (write)

Identity is **(`platform`, `name`)**, case-insensitive on the name. Send the fields you know;
absent fields are left unchanged on an existing contact. Merge rules on an existing row:
`aliases` are unioned (case-insensitive), `first_seen` keeps the earliest, `last_contact` keeps
the latest, every other supplied field overwrites, an empty string clears a text field, and the
latest `name` casing wins.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, required, ≤ 200 | Display name as seen in the app. Whitespace is collapsed. |
| `platform` | string, required, ≤ 32 | Lower-case identifier: `messenger`, `viber`, … (`[a-z0-9._-]`). |
| `aliases` | string[] ≤ 50 × 200 | Other names/handles for the same person. |
| `role` | string ≤ 200 | e.g. `Principal`, `Grade 5 adviser`, `Division ICT coordinator`. |
| `school` | string ≤ 200 | |
| `stage` | enum | `intro` · `pilot` · `active` · `dormant` · `unknown` (default `unknown`). |
| `notes` | string ≤ 8000 | The extracted summary. Never raw messages. |
| `first_seen`, `last_contact` | ISO 8601 | Any offset is accepted; stored as UTC. |
| `is_test` | boolean | Marks synthetic records; excluded from listings unless `include_test=1`. |

```bash
curl -sS -X POST "$HIRAIA_CRM_BASE_URL/contacts" \
  -H "Authorization: Bearer $HIRAIA_CRM_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: contact:messenger:maria-santos:2026-10-28T09:00:00Z" \
  -d '{
    "name": "Maria Santos", "platform": "messenger", "aliases": ["Ma'\''am Santos"],
    "role": "Principal", "school": "DaangHari Elementary School", "stage": "pilot",
    "notes": "Agreed to pilot in two Grade 5 sections; wants the APK before the division meeting.",
    "first_seen": "2026-09-01T08:00:00+08:00", "last_contact": "2026-10-27T18:15:00+08:00"
  }'
```

Response `201 Created` (new) or `200 OK` (existing):

```json
{"id": 12, "created": true, "changed": true,
 "contact": {"id": 12, "name": "Maria Santos", "platform": "messenger", "aliases": ["Ma'am Santos"],
             "role": "Principal", "school": "DaangHari Elementary School", "stage": "pilot",
             "notes": "Agreed to pilot …", "first_seen": "2026-09-01T00:00:00.000Z",
             "last_contact": "2026-10-27T10:15:00.000Z", "is_test": false,
             "created_at": "2026-10-28T01:00:00.000Z", "updated_at": "2026-10-28T01:00:00.000Z"}}
```

Store the returned `id` locally — threads and extracts reference it.

### `POST /api/crm/threads` — upsert a conversation thread (write)

Identity is **(`contact_id`, `app`, `thread_name`)**, case-insensitive on the name. `last_seen`
keeps the latest value.

| Field | Type | Notes |
| --- | --- | --- |
| `contact_id` | integer, required | From the contacts upsert. `422 unknown_contact` otherwise. |
| `app` | string, required, ≤ 32 | `messenger`, `viber`, … |
| `thread_name` | string, required, ≤ 300 | Thread title/participant label as shown in the app. |
| `last_seen` | ISO 8601 | Last message time observed in the thread. |

```bash
curl -sS -X POST "$HIRAIA_CRM_BASE_URL/threads" \
  -H "Authorization: Bearer $HIRAIA_CRM_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: thread:messenger:maria-santos:2026-10-28T09:00:00Z" \
  -d '{"contact_id": 12, "app": "messenger", "thread_name": "Maria Santos", "last_seen": "2026-10-27T18:15:00+08:00"}'
# 201 {"id": 3, "created": true, "changed": true, "thread": {"id": 3, "contact_id": 12, "app": "messenger", "thread_name": "Maria Santos",
#      "last_seen": "2026-10-27T10:15:00.000Z", "created_at": "…", "updated_at": "…"}}
```

### `POST /api/crm/extracts` — append an extraction (write, append-only)

Every call appends a row — this is the one endpoint where a retry without an `Idempotency-Key`
creates a duplicate, so **always send one**.

| Field | Type | Notes |
| --- | --- | --- |
| `contact_id` | integer, required | |
| `thread_id` | integer | Must belong to `contact_id` (`422 unknown_thread` otherwise). |
| `source_thread` | string ≤ 300 | Free-form pointer, e.g. `messenger:Maria Santos`. |
| `extracted_json` | object, required, ≤ 200 KB | The classifier output, stored verbatim and returned parsed. |
| `model_version` | string ≤ 100 | Classifier/prompt version that produced it. |

```bash
curl -sS -X POST "$HIRAIA_CRM_BASE_URL/extracts" \
  -H "Authorization: Bearer $HIRAIA_CRM_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: extract:messenger:maria-santos:msg-88213:harvestd-2026-10" \
  -d '{"contact_id": 12, "thread_id": 3, "source_thread": "messenger:Maria Santos",
       "extracted_json": {"summary": "Asked for the APK link and the parent consent form.",
                          "intent": "pilot-logistics", "next_step": "send consent form", "sentiment": "positive"},
       "model_version": "harvestd-2026-10"}'
# 201 {"id": 57, "created": true, "extract": {"id": 57, "contact_id": 12, "thread_id": 3, "source_thread": "messenger:Maria Santos",
#      "extracted_json": {…}, "model_version": "harvestd-2026-10", "created_at": "2026-10-28T01:00:02.000Z"}}
```

### `GET /api/crm/contacts` — list with filters (read)

| Query | Meaning |
| --- | --- |
| `stage=pilot` | One of the five stages. |
| `platform=messenger` | Exact platform. |
| `quiet_for_days=14` | `last_contact` older than N days **or never contacted**. |
| `search=santos` | Case-insensitive substring over name, aliases, school, role, notes. |
| `include_test=1` | Include `is_test` records (excluded by default). |
| `limit` (1–200, default 50), `offset` | Paging. |

Sorted by `last_contact` descending, never-contacted last. Each row adds `thread_count`,
`extract_count`, `last_extract_at`.

```bash
curl -sS -H "Authorization: Bearer $HIRAIA_CRM_API_KEY" "$HIRAIA_CRM_BASE_URL/contacts?stage=pilot&quiet_for_days=14&limit=20"
# {"contacts":[{"id":12,"name":"Maria Santos",…,"thread_count":1,"extract_count":4,"last_extract_at":"…"}],"total":1,"limit":20,"offset":0}
```

### `GET /api/crm/contacts/:id` — one contact with threads and latest extracts (read)

`?extracts_limit=20` (0–100). `404 not_found` for an unknown id.

```json
{"contact": {…}, "threads": [{…}], "extracts": [{"id": 57, "extracted_json": {…}, "created_at": "…"}, …]}
```

### `GET /api/crm/extracts` — recent extractions (read)

`contact_id=12`, `since=2026-10-01T00:00:00Z`, `limit` (1–100, default 20), `offset`,
`include_test=1`. Newest first.

## Idempotency keys

- Header `Idempotency-Key: <1–200 printable ASCII characters>` on any POST.
- Scope is **per client**: the first `2xx` response for a key is stored for **30 days** and
  replayed verbatim on every retry, with `Idempotent-Replayed: true`. The write happens inside the
  same database transaction as the key record, so a retried extract append can never double-write.
- Reusing a key with a **different body** (field order does not matter) returns
  `422 idempotency_key_reused`. Treat that as a bug in key derivation, not something to retry.
- Validation failures (`4xx`) are not stored; fix the payload and resend with the same key.
- Derive keys deterministically from the source so a crash-and-resume replays cleanly, e.g.
  `extract:<app>:<thread id>:<message id>:<model_version>` and
  `contact:<platform>:<normalized name>:<snapshot time>`. UUIDv4 per attempt is acceptable only if
  the key is persisted locally before the request is sent.

## Retries and backoff

| Response | Action |
| --- | --- |
| network error / timeout (use a 30 s client timeout) | Retry with the **same** Idempotency-Key. |
| `429 rate_limited` | Wait `Retry-After` seconds (present on every 429), then retry. |
| `502`, `503`, `504` (service restarting, nginx) | Retry. |
| `500 internal_error` | Retry once, then park the item and report it with the `X-Request-Id`. |
| `400`, `413`, `415`, `422` | Do not retry; fix the payload. |
| `401`, `403` | Do not retry; key/scope problem — surface it immediately. |

Backoff: exponential with full jitter, base 1 s, doubling to a 60 s cap, at most 8 attempts per
item per run; items still failing are kept in the local queue for the next run. Send requests
sequentially (one in flight) — the data set is small and the store is SQLite behind one process.

## Rate limits and sizes

| Limit | Value |
| --- | --- |
| Edge (nginx), per client address | 10 requests/s, burst 40, then `429` |
| Service, per client key | 300 requests/min, burst 60, then `429` (`Retry-After: 10`) |
| Failed authentications, per address | 30 then 1/s, `429` |
| Request body | 256 KB (`413`) |
| `extracted_json` | 200 KB serialized |
| List page | ≤ 200 contacts, ≤ 100 extracts |

A full resync of a few hundred contacts at ≤ 5 requests/s completes in minutes without touching
either limit.

## Error format

```json
{"error": "invalid_field", "message": "platform must be a short lower-case identifier (e.g. messenger, viber)", "details": {"field": "platform"}}
```

Codes: `unauthorized`, `forbidden`, `https_required`, `not_found`, `method_not_allowed`,
`json_required`, `invalid_json`, `empty_body`, `payload_too_large`, `missing_field`,
`invalid_field`, `field_too_long`, `invalid_timestamp`, `invalid_query`,
`invalid_idempotency_key`, `idempotency_key_reused`, `unknown_contact`, `unknown_thread`,
`rate_limited`, `internal_error`.

## Suggested sync loop

1. `GET /health`; if not `200 {"ok":true}`, stop and retry on the next tick.
2. For each extracted conversation: upsert the contact → upsert the thread (with the returned
   `contact_id`) → append the extract (with both ids). Persist the ids and the idempotency keys
   locally before each request.
3. Mark test runs with `is_test: true` on the contact so they never appear in Beaniebot answers.
4. Log only request ids, status codes and your own record ids — never payloads or the key.

## What must never be sent

Raw message bodies, attachments, phone numbers or e-mail addresses that were not deliberately
extracted as contact details, other people's conversations, and anything about students.
`notes` and `extracted_json` are summaries about the school-pipeline relationship only.
