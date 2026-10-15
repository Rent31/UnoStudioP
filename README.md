# UNOshima

Database-free peer-to-peer multiplayer UNO for Vercel.

## Deploy

1. Import the repository into Vercel.
2. Keep the default framework preset: Next.js.
3. Click Deploy.

No environment variables, database, migrations, API keys, or external account setup are required.

## How rooms work

- One browser runs the authoritative game engine. Every browser keeps an up to date copy of the room, so the room no longer dies with the browser that opened it: if that one drops, the next in join order picks it up, and hands it back when the owner returns.
- Coming back to the room code puts you in the seat you left. Joining mid-game puts you on the rail as a watcher instead of turning you away.
- Traffic goes over WebRTC (Trystero) first: direct, end-to-end encrypted, no server in the middle. Public Nostr relays are used only for peer discovery and signaling.
- Networks that refuse a direct connection fall back to the relay mesh: the same packets mirrored through public MQTT-over-WebSocket brokers on port 443, which no NAT or firewall blocks. Brokers see only an opaque topic and AES-GCM ciphertext, never names, hands, chat or room codes. Anything addressed to one player is sealed with a key only that pair can derive.
- Hidden hands are sanitized by the owner before views are sent to each participant.

### When WebRTC cannot connect at all

A direct connection needs a TURN server on the worst networks (symmetric NAT, strict corporate firewalls, some mobile carriers). Add one and set:

```bash
NEXT_PUBLIC_TURN_URLS=turn:host:3478,turns:host:443
NEXT_PUBLIC_TURN_USERNAME=...
NEXT_PUBLIC_TURN_CREDENTIAL=...
```

Cloudflare Calls and Metered both have free tiers. Without TURN the relay mesh still carries the game, just with a little more latency.

The relay mesh is configurable too (semicolon separated):

```bash
NEXT_PUBLIC_RELAY_BROKERS=wss://broker.emqx.io:8084/mqtt;wss://broker.hivemq.com:8884/mqtt
```

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
