# MapSquad

A lightweight Slido-style Q&A for maps, powered by Cloudflare Workers, Durable Objects, Bootstrap 5, and Leaflet.

## Features
- Create or join a room with a short code
- Ask a question
- Select a question and click the map to drop answer pins
- Live updates via WebSockets (Durable Object)

## Develop

- Prereqs: Node 18+, Wrangler CLI
- Install deps (dev-only):
  - `npm i`
- Run locally:

```bash
npm run dev
```

Open http://localhost:8787/

## Deploy

```bash
npm run deploy
```

## Notes
- Durable Object class: `Room` bound as `ROOMS`
- Static assets served from `public/` (binding `ASSETS`)
- Basic presence list is ephemeral; no persistence yet.
