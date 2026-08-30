# @hiraia/web

Web demo for Hiraia AI Science Tutor using Next.js and QVAC's OpenAI-compatible HTTP API.

## Features

- 🌐 Browser-based interface for judges and demo users
- 🔄 Real-time streaming responses
- 🌍 Multi-language support (English, Tagalog, Cebuano)
- 📝 Markdown rendering for formatted responses
- 🎨 Clean, responsive UI with Tailwind CSS

## Prerequisites

- QVAC server running with Qwen3-1.7B model loaded
- Node.js 18+ and pnpm

## Setup

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

## QVAC Server Setup

The web app connects to a QVAC server exposing an OpenAI-compatible API. To start a QVAC server:

```bash
# On a machine with GPU and QVAC installed
qvac serve --model qwen3-1.7b --port 8080
```

Or use Docker:

```bash
docker run -p 8080:8080 qvac/server:latest --model qwen3-1.7b
```

## Configuration

Update the server URL in the UI (default: `http://localhost:8080`).

For production deployment, set the `QVAC_SERVER_URL` environment variable:

```bash
QVAC_SERVER_URL=https://your-qvac-server.com pnpm build
```

## Architecture

```
packages/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx       # Root layout
│   │   ├── page.tsx         # Main page
│   │   └── globals.css      # Global styles
│   ├── components/
│   │   └── ChatInterface.tsx # Chat UI component
│   ├── engine/
│   │   └── RemoteEngine.ts  # QVAC HTTP API client
│   └── store/
│       └── useChatStore.ts  # Zustand state management
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

## RemoteEngine

The `RemoteEngine` class implements the `TutorEngine` interface using QVAC's OpenAI-compatible HTTP API:

- **`chat()`** - Streams responses via `/v1/chat/completions` (SSE)
- **`generateImage()`** - Creates visuals via `/v1/images/generations`
- **`initialize()`** - Tests connection via `/v1/models`

## Build for Production

```bash
pnpm build
pnpm start
```

## Deployment

Deploy to Vercel, Netlify, or any Next.js hosting platform:

```bash
# Vercel
vercel deploy

# Netlify
netlify deploy --prod
```

## Demo for Hackathon

The web demo allows judges to try Hiraia without installing the mobile app:

1. Host QVAC server on a GPU machine (cloud VM or local)
2. Deploy web app to Vercel/Netlify
3. Share the URL in hackathon submission
4. Include demo video showing both mobile and web experiences

## License

Apache 2.0

## The demo card feed (inventory + the dynamic card)

The lightbox's question-cards feed walks a **~5% subset of the app's 46,421-card pool**
(2,321 cards, 1,725 illustrations, 25 MB). Regenerate it with:

```bash
node packages/web/scripts/build-demo-subset.mjs        # ~40s, fully deterministic
DEMO_SKIP_IMAGES=1 node packages/web/scripts/build-demo-subset.mjs   # data only
npx tsx scripts/smoke-card-demo.mts                    # headless store walk, no server needed
```

The subset is **not** a random sample. The feed is a walk over a card graph, so the subset
is chosen for that graph: it ships a frozen full-corpus idf table (`src/data/demo-df.json`)
because every edge gate is a threshold on idf mass, and it is grown by connected expansion
from one seed per (domain, grade) cell. The result is one component, zero dead ends and a
fork rate of 11.0% against the device's measured 11.8%. A random 5% shatters into 794
components with 33.5% dead ends, and 90% of the "related topic" links it serves are junk.
**The full rule, and the measurements, are in the header of `scripts/build-demo-subset.mjs`.**

A typed question that the subset cannot answer is not a dead end either: it goes to
`/api/demo/card`, which retrieves over the WHOLE fact bank server-side and returns one of the
same three cards the phone prints — a grounded fact card, an honest in-domain gap, or "I'm
only a science tutor". See `src/server/rag.ts` (`retrieveForCard`) and `deploy/README.md` §5.
