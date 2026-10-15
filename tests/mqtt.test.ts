// Codec checks for the MQTT client, driven by a fake socket so they run
// offline (this sandbox cannot reach a broker).
// Run with: npx tsx tests/mqtt.test.ts

let failures = 0;
const ok = (cond: boolean, label: string) => {
  if (cond) console.log("PASS " + label);
  else { failures += 1; console.log("FAIL " + label); }
};

// ─── a stand-in for the browser WebSocket ───────────────────────────────────
const sent: Uint8Array[] = [];
let socketBox: FakeSocket | null = null;
const sock = () => socketBox as FakeSocket;

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1;
  binaryType = "arraybuffer";
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string, public protocol: string) {
    socketBox = this;
    // a real socket opens asynchronously, after the handlers are attached
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: Uint8Array) { sent.push(data); }
  close() { this.readyState = 3; }
  /** pretend the broker spoke */
  deliver(bytes: number[]) { this.onmessage?.({ data: new Uint8Array(bytes).buffer }); }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

import { MqttLite } from "../src/lib/mqttlite";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const lastPacket = () => sent[sent.length - 1];
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const strBytes = (s: string): number[] => {
  const u = new TextEncoder().encode(s);
  return [(u.length >> 8) & 0xff, u.length & 0xff, ...u];
};

(async () => {
  const ml = new MqttLite("wss://broker.test/mqtt", { keepAlive: 20, connectTimeout: 9000 });
  let live: boolean = false;
  const inbox: Uint8Array[] = [];
  ml.onLive = (v) => { live = v; };
  ml.onMessage = (payload) => inbox.push(payload);

  void ml.subscribe("uno/topic");
  await tick();

  // CONNECT: fixed header, protocol name, level, keepalive
  ok(socketBox !== null && sock().protocol === "mqtt", "open: the socket asks for the mqtt subprotocol");
  const connect = sent[0];
  ok(connect[0] === 0x10, "connect: CONNECT fixed header");
  ok(text(connect.subarray(4, 8)) === "MQTT", "connect: protocol name is MQTT");
  ok(connect[8] === 0x04, "connect: protocol level 4 (3.1.1)");
  ok(((connect[10] << 8) | connect[11]) === 20, "connect: keepalive of 20s");

  // CONNACK accepted -> SUBSCRIBE follows
  sock().deliver([0x20, 0x02, 0x00, 0x00]);
  await tick();
  const sub = lastPacket();
  ok(sub[0] === 0x82, "subscribe: SUBSCRIBE fixed header");
  const subPid = (sub[2] << 8) | sub[3];
  const topicLen = (sub[4] << 8) | sub[5];
  ok(text(sub.subarray(6, 6 + topicLen)) === "uno/topic", "subscribe: topic filter is on the wire");
  ok(sub[6 + topicLen] === 1, "subscribe: asks for QoS 1");

  // SUBACK -> live
  sock().deliver([0x90, 0x03, (subPid >> 8) & 0xff, subPid & 0xff, 0x01]);
  await tick(40);
  ok(!!live, "suback: the client reports itself live");

  // PUBLISH + PUBACK
  const p = ml.publish("uno/topic", "hello mesh", { qos: 1 });
  await tick();
  const pub = lastPacket();
  ok((pub[0] & 0xf0) === 0x30, "publish: PUBLISH fixed header");
  ok((pub[0] & 0x06) === 0x02, "publish: QoS 1 flag is set");
  const pubTopicLen = (pub[2] << 8) | pub[3];
  ok(text(pub.subarray(4, 4 + pubTopicLen)) === "uno/topic", "publish: topic is on the wire");
  const pubPid = (pub[4 + pubTopicLen] << 8) | pub[5 + pubTopicLen];
  ok(text(pub.subarray(6 + pubTopicLen)) === "hello mesh", "publish: payload is intact");
  sock().deliver([0x40, 0x02, (pubPid >> 8) & 0xff, pubPid & 0xff]);
  ok(await p === true, "puback: the publish promise settles");

  // an incoming publish on our topic
  const payloadBytes = [...strBytes("uno/topic"), 0x00, 0x07, ...new TextEncoder().encode("delivered")];
  sock().deliver([0x32, payloadBytes.length, ...payloadBytes]);
  await tick();
  ok(inbox.length === 1 && text(inbox[0]) === "delivered", "receive: a packet on our topic is handed over");
  const pong = lastPacket();
  ok(pong[0] === 0x40, "receive: QoS 1 gets a PUBACK back");

  // a packet for another topic is dropped (brokers only send ours, be safe)
  const otherBytes = [...strBytes("uno/other"), 0x00, 0x07, ...new TextEncoder().encode("nope")];
  sock().deliver([0x32, otherBytes.length, ...otherBytes]);
  await tick();
  ok(inbox.length === 1, "receive: other topics are ignored");

  // a frame that cannot be framed is ignored, and does not wedge the stream
  {
    const before = inbox.length;
    sock().deliver([0x32, 0x00, 0x00, 0x01, 0x00, 0x0a, ...strBytes("nonsense frame")]);
    await tick();
    ok(inbox.length === before, "receive: a malformed frame is ignored");
    // wipe the backlog the way the client does when it gives up framing
    (ml as unknown as { rx: Uint8Array }).rx = new Uint8Array(0);
    const after = [...strBytes("uno/topic"), 0x00, 0x08, ...new TextEncoder().encode("still here")];
    sock().deliver([0x32, after.length, ...after]);
    await tick();
    ok(inbox.length === before + 1, "receive: the stream recovers after a bad frame");
  }

  // splitting a frame across two chunks must still parse
  const split = [...strBytes("uno/topic"), 0x00, 0x09, ...new TextEncoder().encode("in pieces")];
  const frame = [0x32, split.length, ...split];
  sock().deliver(frame.slice(0, 6));
  sock().deliver(frame.slice(6));
  await tick();
  ok(text(inbox[inbox.length - 1]) === "in pieces", "framing: a split frame is reassembled");

  // a refused connection must not go live
  {
    const second = new MqttLite("wss://broker.test/mqtt", { connectTimeout: 9000 });
    let live2: boolean = false;
    second.onLive = (v) => { live2 = v; };
    void second.subscribe("uno/topic");
    await tick();
    const sock2 = sock();
    sock2.deliver([0x20, 0x02, 0x00, 0x05]); // not authorised
    await tick(40);
    ok(live2 === false, "refused: a rejected CONNACK never goes live");
    second.end();
  }

  // ending stops the traffic
  sent.length = 0;
  ml.end();
  await tick();
  const afterEnd = await ml.publish("uno/topic", "after end", { qos: 1 });
  ok(afterEnd === false && sent.length === 0, "end: nothing is published after the client is closed");

  console.log(failures === 0 ? "ALL MQTT TESTS PASSED" : failures + " FAILURES");
  process.exit(failures === 0 ? 0 : 1);
})();
