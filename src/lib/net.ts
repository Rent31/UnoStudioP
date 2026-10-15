// ─── UNOshima · shared networking constants ─────────────────────────────────
//
// Kept in one place because the peer transport, the relay mesh and the room
// code all have to agree on the app id.

export const APP_ID = "uno-studio-p2p-v1";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function uid(len = 12) {
  let s = "";
  const bytes = new Uint8Array(len);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// ─── WebRTC ICE configuration ───────────────────────────────────────────────
//
// Peers on different networks need help traversing NAT:
//
//   STUN  - discovers your public address. Free, unlimited, no account.
//           Handles the large majority of home and office networks.
//   TURN  - relays traffic when no direct path exists (symmetric NAT, strict
//           corporate firewalls, some mobile carriers). Needs a credentialed
//           server, so it is opt-in through env vars.
//
// Enable TURN by setting (Cloudflare and Metered both have free tiers):
//   NEXT_PUBLIC_TURN_URLS=turn:host:3478,turns:host:443
//   NEXT_PUBLIC_TURN_USERNAME=...
//   NEXT_PUBLIC_TURN_CREDENTIAL=...

const STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun2.l.google.com:19302",
  "stun:stun3.l.google.com:19302",
  "stun:stun4.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
  "stun:global.stun.twilio.com:3478",
  "stun:stun.nextcloud.com:3478",
];

function turnServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_TURN_URLS;
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (!raw || !username || !credential) return [];
  const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return [];
  return [{ urls, username, credential }];
}

export const hasTurn = () => turnServers().length > 0;

export function rtcConfig(): RTCConfiguration {
  return {
    iceServers: [{ urls: STUN_URLS }, ...turnServers()],
    iceCandidatePoolSize: 4,
  };
}
