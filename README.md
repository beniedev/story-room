# Story-native Writing Harness

A local-first AI novel-writing demo where the manuscript—not a chat transcript—is the source of truth. A small Node host owns readable story files for local use; the owner-only OpenAI Sites build stores the same Book model in a private cloud database for desktop and mobile access.

The demo keeps each Book isolated, supports author and first-person character control, previews generated prose before applying it, and shows the exact prompt plan assembled for each request. It does not connect to a real model yet.

## Run the demo

Requirements: Node.js 24+ and npm.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4310`.

For a phone on the same trusted private network, bind both local development processes to a specific private address:

```bash
npm run dev -- --host <private-address>
```

This mode has no access control. Do not expose it to the public internet.

## Private cloud demo

The Sites deployment is owner-only. It starts with neutral sample Books and stores edits in its managed database, so the same private demo library is available across the owner's signed-in devices. Local `.data/` stories are never bundled, uploaded, or imported automatically.

## What is implemented

- Continuous prose editor with author and first-person character modes
- Book-owned character cards, world rules, canon, summaries, chapters, and sections
- Human-readable host-side persistence under `.data/`
- Owner-only Sites persistence backed by a managed D1 database
- Editable Book writing brief and per-source prompt inclusion controls
- Prompt-plan inspector with ordered layers, provenance, inclusion reasons, and estimated size
- Deterministic offline Fake Provider with preview-before-apply
- Story directory, simple relationship view, and Paper / Manga Bloom themes
- Responsive controls for desktop and mobile-sized viewports

## What is intentionally absent

- Real model calls, API-key UI, or a plaintext secret store
- SillyTavern compatibility or private-data import
- Chat bubbles, group chat, RAG, embeddings, multi-user collaboration, or a desktop wrapper
- Production authentication for LAN access

## Verify

```bash
npm test
npm run typecheck
npm run build
npm run build:local
```

Current status: functional DEMO with local-host and private Sites build paths, not a production writing system. Real-device behavior must be reported only after it is actually tested.
