# UNO Studio

Database-free peer-to-peer multiplayer UNO for Vercel.

## Deploy

1. Import the repository into Vercel.
2. Keep the default framework preset: Next.js.
3. Click Deploy.

No environment variables, database, migrations, API keys, or external account setup are required.

## How rooms work

- The room owner's browser runs the authoritative game engine.
- Browsers connect directly over WebRTC using Trystero.
- Public Nostr relays are used only for encrypted WebRTC peer discovery and signaling.
- Hidden hands are sanitized by the owner before views are sent to each participant.
- The owner's room state is backed up in that browser's local storage for reload recovery.
- The owner must keep the room tab open. Leaving intentionally closes the room for everyone.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. No `.env` file is needed.

## Production validation

```bash
npm ci
npm run build
```

The build script clears `.next` first so deleted routes cannot survive a deployment cache.
