export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, transport: "webrtc-p2p" });
}
