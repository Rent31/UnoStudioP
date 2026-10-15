"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Info } from "lucide-react";
import {
  createHostIntent,
  generateRoomCode,
  saveName,
  savePendingName,
  savedName,
} from "@/lib/client";
import { playSound } from "@/lib/sound";
import { ThemeToggle, SoundToggle } from "@/components/Toggles";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(savedName()); }, []);

  const go = () => {
    const nm = name.trim();
    if (!nm) { setError("Pick a name."); playSound("error"); return; }
    if (mode === "join" && code.trim().length < 4) { setError("Enter the room code."); playSound("error"); return; }
    setBusy(true); setError("");
    saveName(nm);

    if (mode === "create") {
      const roomCode = generateRoomCode();
      createHostIntent(roomCode, nm);
      playSound("join");
      router.push(`/room/${roomCode}`);
      return;
    }

    const roomCode = code.trim().toUpperCase();
    savePendingName(roomCode, nm);
    playSound("click");
    router.push(`/room/${roomCode}`);
  };

  return (
    <main className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 md:px-8 h-14">
        <span />
        <div className="flex items-center gap-2">
          <Link href="/rules" className="iconbtn" title="Rules and cards"><Info size={15} /></Link>
          <SoundToggle />
          <ThemeToggle />
        </div>
      </header>

      <section className="flex-1 flex items-center justify-center px-5 pb-12">
        <div className="w-full max-w-[380px] a-fade">
          <div className="brand select-none">
            <span className="brand-mark" aria-hidden>
              <i style={{ background: "#e63b1f" }} />
              <i style={{ background: "#f2c200" }} />
              <i style={{ background: "#1565d8" }} />
              <i style={{ background: "#34a853" }} />
            </span>
            <span className="disp brand-uno">UNO<span className="brand-shima">shima</span></span>
          </div>

          <input
            className="input"
            maxLength={14}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />

          <div className="flex mt-3 border border-[var(--line2)]">
            {(["create", "join"] as const).map((m) => (
              <button
                key={m}
                className={`tabfont flex-1 py-2.5 text-[13px] transition-colors ${mode === m ? "bg-[var(--surf2)] text-[var(--ink)]" : "text-[var(--mut)] hover:text-[var(--ink)]"}`}
                onClick={() => { setMode(m); playSound("click"); }}
              >
                {m === "create" ? "New room" : "Join room"}
              </button>
            ))}
          </div>

          {mode === "join" && (
            <input
              className="input mt-3 mono !text-[24px] tracking-[0.35em] uppercase text-center a-fade"
              maxLength={6}
              placeholder="CODE"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && go()}
            />
          )}

          <button className="btn acc w-full mt-3 !py-3.5" onClick={go} disabled={busy}>
            {busy ? "One moment" : <>{mode === "create" ? "Create" : "Join"} <ArrowRight size={15} /></>}
          </button>

          {error && <p className="text-[12px] text-[#ff6b52] mt-3 text-center a-pop">{error}</p>}

        </div>
      </section>
    </main>
  );
}
