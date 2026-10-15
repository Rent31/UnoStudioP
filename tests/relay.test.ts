// Headless checks for the encrypted relay mesh: no broker, no browser.
// Run with: npx tsx tests/relay.test.ts

process.env.NEXT_PUBLIC_RELAY_BROKERS = "wss://invalid.invalid/mqtt";
process.on("unhandledRejection", (e) => { console.log("UNHANDLED", e); failures += 1; });

import { EncryptedRelay, type RelayKind, type RelayMessage } from "../src/lib/relay";

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log("PASS " + label);
  else { failures += 1; console.log("FAIL " + label); }
};

const CODE = "SUNSET";
const enc = new TextEncoder();
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

type Wire = {
  brokers: { url: string; ready: boolean; ml: { publish: (t: string, w: string, o?: unknown) => Promise<void>; end: () => void } }[];
  receive: (raw: Uint8Array) => void;
  flush: () => void;
};

interface Peer {
  self: string;
  relay: EncryptedRelay;
  inbox: RelayMessage[];
  live: boolean;
  publish: (topic: string, wire: string) => Promise<void>;
}

const mesh: Peer[] = [];

async function addPeer(self: string): Promise<Peer> {
  const inbox: RelayMessage[] = [];
  const relay = new EncryptedRelay(CODE, self, (m) => inbox.push(m), () => undefined);
  await relay.start();
  const peer: Peer = { self, relay, inbox, live: true, publish: async () => undefined };
  // the real broker is replaced by the in-process mesh
  peer.publish = async (_topic: string, payload: string) => {
    if (!peer.live) return;
    for (const other of mesh) {
      if (other.self === self || !other.live) continue;
      (other.relay as unknown as Wire).receive(enc.encode(payload));
    }
  };
  (relay as unknown as Wire).brokers = [{
    url: "mesh",
    ready: true,
    ml: { publish: (t: string, w: string) => peer.publish(t, w), end: () => undefined },
  }];
  mesh.push(peer);
  return peer;
}

/** divert one peer's packets into a sink instead of the mesh */
function intercept(p: Peer, sink: (wire: string) => void) {
  (p.relay as unknown as Wire).brokers[0].ml.publish = async (_t: string, w: string) => { sink(w); };
}
function release(p: Peer) {
  (p.relay as unknown as Wire).brokers[0].ml.publish = (t: string, w: string) => p.publish(t, w);
}

const send = (p: Peer, kind: RelayKind, data: unknown, target?: string) => p.relay.send(kind, data, target);
const kinds = (p: Peer) => p.inbox.map((m) => m.kind);

(async () => {
  const a = await addPeer("peer-a");
  const b = await addPeer("peer-b");
  const c = await addPeer("peer-c");

  // everybody announces itself first: this is how exchange keys get around
  for (const p of [a, b, c]) await send(p, "presence", { pid: p.self, joinedAt: 1 });
  await tick(150);
  for (const p of [a, b, c]) p.inbox.length = 0;

  // ---------------- broadcasts ride the room key
  await send(a, "host", { hostPid: "p1", joinedAt: 5 });
  await tick();
  ok(b.inbox.length === 1 && b.inbox[0].kind === "host", "broadcast: every peer gets it");
  ok(JSON.stringify(b.inbox[0].data) === JSON.stringify({ hostPid: "p1", joinedAt: 5 }), "broadcast: payload survives");
  ok(b.inbox[0].from === "peer-a", "broadcast: the sender is named");
  ok(c.inbox.length === 1, "broadcast: all three peers are in the mesh");

  // ---------------- targeted packets are pairwise sealed
  b.inbox.length = 0; c.inbox.length = 0;
  await send(a, "snapshot", { hand: ["r5", "b9", "wild"] }, "peer-b");
  await tick();
  ok(b.inbox.length === 1 && JSON.stringify(b.inbox[0].data).includes("r5"), "pairwise: the target can read it");
  ok(c.inbox.length === 0, "pairwise: the rest of the room cannot");
  ok(b.inbox[0].target === "peer-b", "pairwise: the envelope keeps its target");

  // ---------------- nothing readable on the wire
  {
    let sealed = "";
    intercept(a, (w) => { sealed = w; });
    await a.relay.send("snapshot", { secret: "my whole hand" }, "peer-b");
    await tick(30);
    release(a);
    ok(sealed.length > 0 && !sealed.includes("my whole hand"), "privacy: the wire never carries plaintext");
    ok(!sealed.includes(CODE) && !sealed.includes("peer-b"), "privacy: neither the code nor the target is on the wire");
  }

  // ---------------- tampering
  b.inbox.length = 0;
  {
    let captured = "";
    intercept(a, (w) => { captured = w; });
    await a.relay.send("mirror", { seq: 3 });
    await tick(30);
    release(a);
    const packet = JSON.parse(captured);
    (b.relay as unknown as Wire).receive(enc.encode(JSON.stringify({ ...packet, body: packet.body.slice(0, -4) + "AAAA" })));
    await tick();
    ok(b.inbox.length === 0, "integrity: a doctored packet is dropped");
    const forged = JSON.parse(captured);
    (b.relay as unknown as Wire).receive(enc.encode(JSON.stringify({ ...forged, sig: forged.sig.slice(0, -4) + "AAAA" })));
    await tick();
    ok(b.inbox.length === 0, "integrity: a bad signature is dropped before decryption");
  }

  // ---------------- mirrored copies arrive once
  b.inbox.length = 0;
  {
    const id = "fixed-id-0001";
    await a.relay.send("command", { type: "draw" }, undefined, id);
    await a.relay.send("command", { type: "draw" }, undefined, id);
    await tick();
    ok(b.inbox.length === 1, "dedupe: a packet repeated by the mesh is delivered once (got " + b.inbox.length + ")");
  }

  // ---------------- impersonation
  b.inbox.length = 0;
  {
    const impostor = await addPeer("peer-a"); // same id, different keys
    await impostor.relay.send("mirror", { seq: 999 });
    await tick();
    ok(b.inbox.length === 0, "identity: a second browser cannot pose as a pinned peer");
    impostor.relay.stop();
    mesh.pop();
  }

  // ---------------- packets wait for a broker
  {
    const d = await addPeer("peer-d");
    d.live = false;
    await d.relay.send("join", { name: "Late" }, "peer-a");
    await tick(150);
    ok(!a.inbox.some((m) => m.kind === "join" && m.from === "peer-d"), "offline: nothing leaves while disconnected");
    d.live = true;
    // the host is still announcing itself, which is what teaches D its key
    await send(a, "host", { hostPid: "p1", joinedAt: 5 });
    await tick(200);
    ok(a.inbox.some((m) => m.kind === "join" && m.from === "peer-d"), "offline: the queue drains once the way is clear");
    d.relay.stop();
    mesh.pop();
  }

  // ---------------- first contact: a reply needs no round trip
  {
    a.inbox.length = 0;
    const e = await addPeer("peer-e");
    // E has heard the host, so it can seal a join straight away
    await send(a, "host", { hostPid: "p1", joinedAt: 5 });
    await tick(60);
    await e.relay.send("join", { name: "Newcomer" }, "peer-a");
    await tick(150);
    ok(a.inbox.some((m) => m.kind === "join" && m.from === "peer-e"), "first contact: the join reaches the host");
    // and the host can answer at once, using the key carried on that join
    e.inbox.length = 0;
    await a.relay.send("welcome", { seat: 4 }, "peer-e");
    await tick(150);
    const welcome = e.inbox.find((m) => m.kind === "welcome");
    ok(!!welcome && JSON.stringify(welcome.data).includes("seat"), "first contact: the welcome is readable straight away");
    ok(!b.inbox.some((m) => m.kind === "welcome"), "first contact: nobody else can read the welcome");
    e.relay.stop();
    mesh.pop();
  }

  console.log(failures === 0 ? "ALL RELAY TESTS PASSED" : failures + " FAILURES");
  process.exit(failures === 0 ? 0 : 1);
})();
