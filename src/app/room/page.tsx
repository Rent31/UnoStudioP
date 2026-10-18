"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RoomClient from "@/components/RoomClient";

/**
 * Static room bootstrap.
 *
 * Vercel rewrites /room/CODE to this one pre-rendered CDN asset, so opening an
 * invite link never waits on a serverless function. The code is read from the
 * visible browser URL after mount, which keeps the server render and the first
 * browser render identical: no cold start, no hydration mismatch, and the old
 * /room/CODE links keep working.
 */
export default function RoomPage() {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const pathMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})\/?$/);
      const queryCode = new URLSearchParams(window.location.search).get("code");
      const raw = pathMatch?.[1] ?? queryCode ?? "";
      const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      setCode(clean.length >= 4 ? clean : "");
    } catch {
      setCode("");
    }
  }, []);

  if (code === null) {
    return (
      <main className="h-dvh grid place-items-center px-5">
        <p className="text-[13px] text-[var(--mut)]">Opening the room…</p>
      </main>
    );
  }

  if (!code) {
    return (
      <main className="h-dvh grid place-items-center px-5">
        <div className="panel w-full max-w-[330px] p-5 text-center">
          <p className="text-[14px] font-semibold">That room link is no good</p>
          <p className="text-[12px] text-[var(--mut)] leading-snug mt-1.5">
            A room code is six letters and digits, like the one under the QR code.
          </p>
          <Link className="btn acc mt-4 w-full" href="/">Back home</Link>
        </div>
      </main>
    );
  }

  return <RoomClient code={code} />;
}
