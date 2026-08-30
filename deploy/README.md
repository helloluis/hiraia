# Hiraia web demo — VPS deployment

Two processes run on the VPS:

1. **Model server** — `llama.cpp` serving Sailor2-3B-Chat (Q4_K_M) + the Tagalog &
   Bisaya LoRA adapters over an OpenAI-compatible API (port `8080`).
2. **Web app** — the Next.js chat UI with login + SQLite persistence (port `3000`).

The browser talks **directly** to the model server (the chat client runs client-side),
so the model server must be reachable from the user's browser, not just localhost.

---

## 0. Get the code + adapters

```bash
git clone <repo> hiraia && cd hiraia
git lfs install && git lfs pull        # pulls the 2 adapter .gguf files (~100 MB each)
```

## 1. Start the model server

```bash
./deploy/serve-model.sh                # CPU (default). Builds llama.cpp, downloads base (~3 GB), serves :8080
# GPU VPS:  NGL=99 ./deploy/serve-model.sh
```

First run builds `llama.cpp` and downloads the base model; later runs are instant.
Sanity check from the VPS:

```bash
curl -s localhost:8080/lora-adapters     # should list id 0 (tagalog), id 1 (bisaya)
```

Leave it running (use `tmux`/`systemd`/`pm2`). On CPU expect a few tokens/sec for a 3B Q4 —
fine for a demo.

## 2. Start the web app

```bash
cd packages/web
pnpm install
pnpm build
# DB lives outside the web folder; override its path if you like:
HIRAIA_DB_PATH=/var/lib/hiraia/hiraia.db pnpm start    # serves :3000
```

## 3. Point the app at the model server

The browser must reach the model server's **public** address. Easiest: after logging in,
click the **"model offline"** chip in the header and set the URL to your VPS, e.g.
`http://YOUR_VPS_IP:8080`, then Connect. (Or bake a default at build time with
`NEXT_PUBLIC_QVAC_URL=http://YOUR_VPS_IP:8080 pnpm build`.)

Open firewall ports `3000` and `8080` (or put both behind nginx — see below).

## 4. Updating (redeploy the latest `main`)

`main` is the single source of truth. To pull the latest, rebuild the web app, and
restart it, run **one command on the VPS**:

```bash
/root/hiraia/deploy/update.sh
```

It hard-resets the repo to `origin/main` (so **don't keep local edits on the server**
— commit them instead; untracked models/adapters/DB are left alone), runs
`pnpm install && pnpm build`, restarts `pm2: hiraia-web`, and checks it returns 200.
The model server (`pm2: hiraia-llm`) is left running; restart it with
`pm2 restart hiraia-llm` only when the model/adapters or `run-llama-server.sh` change.

## 5. Grounded web demo (server-side RAG) — the public "Try the demo" lightbox

The public demo (`/`, the lightbox — distinct from the authed browser-direct chat above)
is a **faithful replica of the shipped APK's grounded path**, served entirely server-side:

```
visitor → /api/demo/chat (Next route, server-side)          — the conversational demo
            ├─ server/rag.ts  → embed query (LaBSE :8090) → retrieve over the bundled
            │                    int8 vectors → grounding block (same bank as the phone)
            ├─ build prompt: generateSystemPrompt (static) + grounding in the USER turn
            └─ → llama-server :8080 (v2a adapter)  → stream SSE back to the browser

visitor → /api/demo/card (Next route, server-side)          — the FEED's ask box
            ├─ the browser searched the bundled ~5% card subset FIRST and missed; this is
            │    the miss path, and it is the phone's LocalEngine.answerQuery
            ├─ server/rag.ts `retrieveForCard` → the SAME three-way gate the phone runs
            │    (shared isOffDomain + the spelling probe): fact card / in-domain gap /
            │    off-domain. The two gap shapes are MODEL-FREE and never reach :8080
            └─ → llama-server :8080, shared card prompt (@hiraia/shared prompts/cards.ts),
                 buffered (not streamed) so sanitizeCardAnswer runs before the card ships
```

The card route degrades to the honest gap card at every layer — embedder down (it then
refuses to classify anything as off-domain, because without a cosine every query looks it),
generation down, retrieval down — and never returns a 5xx to the browser.

Three processes now: **hiraia-llm** (:8080, generation), **hiraia-embed** (:8090, LaBSE),
**hiraia-web** (:3005). The browser never touches :8080/:8090 for the demo — the route
proxies them (both bound to 127.0.0.1).

**Start the embedder (once):**
```bash
pm2 start /root/hiraia/deploy/run-embed-server.sh --name hiraia-embed && pm2 save
curl -s 127.0.0.1:8090/v1/embeddings -H 'Content-Type: application/json' \
  -d '{"input":"ano ang photosynthesis","model":"labse"}' | python3 -c \
  'import json,sys;e=json.load(sys.stdin)["data"][0]["embedding"];print("dims",len(e))'  # → 768
```
`run-embed-server.sh` auto-downloads `labse.Q4_K_M.gguf` from the model mirror on first
run (into the gitignored `deploy/models/`, so it survives `update.sh`). It MUST be the
**Q4_K_M** quant + **CLS** pooling — that's what the corpus vectors blob's 0.99999
query/corpus parity was verified against (see mobile `config/model.ts` EMBEDDER).

**The web route needs no env in the default layout** — it defaults to `localhost:8080`
(generation), `localhost:8090` (embed), and reads the vectors blob from
`packages/mobile/assets/rag/` (relative to the web cwd). Override with `HIRAIA_MODEL_URL`,
`HIRAIA_EMBED_URL`, `HIRAIA_RAG_DIR` if the layout changes.

**Bank ↔ vectors must match:** `server/rag.ts` attaches the int8 blob only if its fact
count equals the bank's length, and its `bankHash` the bank's hash (else it throws and stays
lexical-only). So whenever the fact bank changes, rebuild the vectors blob in the SAME
commit. A `git lfs pull` on deploy keeps the blob current.

### Ship process when a new official APK goes out
The web demo's model + bank should track the shipped APK exactly:
1. The APK's adapter GGUFs already live at `packages/mobile/assets/models/adapter-{tagalog,bisaya}.gguf`
   (git-lfs). `run-llama-server.sh` points there — so they ship to the VPS automatically.
2. On the VPS: `deploy/update.sh` (rebuilds + restarts web), then
   `git lfs pull && pm2 restart hiraia-llm` to load the new adapter, and — only if the
   bank changed — the web reads `rag/bank/science-facts.jsonl` at boot, so a `git pull`
   already gave it the new bank; only the blob needs the `git lfs pull`.
3. Verify: `/qvac/lora-adapters` lists id 0 + 1; a science query returns a grounded
   answer; an off-topic query abstains (no spurious facts).

---

## Notes

- **Adapter selection is automatic**: the language dropdown picks the adapter
  (Tagalog → id 0, Bisaya → id 1, English → base). The request sends explicit
  `lora` scales so adapters never stack.
- **Persistence**: users/chats/messages/feedback are stored in SQLite at
  `HIRAIA_DB_PATH` (default `<repo>/data/hiraia.db`, kept out of git).
- **HTTPS / mixed content**: if you serve the web app over HTTPS, the model server
  must also be HTTPS (browsers block https→http). Simplest is to reverse-proxy both
  under one origin with nginx:
  ```nginx
  location /        { proxy_pass http://127.0.0.1:3000; }
  location /v1/     { proxy_pass http://127.0.0.1:8080; }
  location /health  { proxy_pass http://127.0.0.1:8080; }
  location /lora-adapters { proxy_pass http://127.0.0.1:8080; }
  ```
  then set the in-app server URL to your site origin (e.g. `https://demo.example.com`).
- Validated: mainline `llama-server` loads the mradermacher Q4_K_M base + our
  QVAC-converted adapters, and per-request adapter switching returns correct,
  language-correct, Socratic answers in both Tagalog and Bisaya on the Q4 quant.
```
