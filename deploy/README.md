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
