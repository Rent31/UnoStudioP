"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { VARIANT_META, GENERAL_RULES, VARIANT_RULES, type Variant } from "@/lib/game/model";
import { MODE_SUMMARY, RULES_CARDS, DECK_TOTAL, describeCard } from "@/lib/game/cardinfo";
import { CardView } from "@/components/CardView";
import { ThemeToggle, SoundToggle } from "@/components/Toggles";
import { playSound } from "@/lib/sound";

const VARIANTS: Variant[] = ["classic", "nomercy", "flip", "flex", "allwild"];

export default function RulesBook() {
  const [v, setV] = useState<Variant>("classic");
  const cards = RULES_CARDS[v];

  return (
    <main className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-4 md:px-7 h-14 border-b border-[var(--line)]">
        <Link href="/" className="iconbtn" title="Back"><ArrowLeft size={15} /></Link>
        <span className="tabfont text-[15px]">Rules</span>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex overflow-x-auto border-b border-[var(--line)]">
        {VARIANTS.map((x) => (
          <button
            key={x}
            onClick={() => { setV(x); playSound("click"); }}
            className={`tabfont shrink-0 px-5 py-3 text-[13px] relative transition-colors ${v === x ? "text-[var(--ink)]" : "text-[var(--mut)] hover:text-[var(--ink2)]"}`}
          >
            {VARIANT_META[x].name}
            {v === x && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-[var(--acc)] a-in" />}
          </button>
        ))}
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto px-4 md:px-7 py-6 pb-16">
        <section key={v} className="a-fade">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="disp text-3xl">{VARIANT_META[v].name}</h2>
            <span className="text-[12px] text-[var(--mut)]">{DECK_TOTAL[v]}</span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {MODE_SUMMARY[v].map((line) => (
              <li key={line} className="text-[13px] text-[var(--ink2)] leading-snug flex gap-2">
                <span className="text-[var(--acc)]">/</span>{line}
              </li>
            ))}
          </ul>

          <h3 className="tabfont text-[14px] mt-8 mb-3">Cards</h3>
          <div className="grid sm:grid-cols-2 gap-2 stagger">
            {cards.map((c, i) => {
              const info = describeCard(c.face, c.variant, {
                flexColor: c.flexColor ?? null,
                flexValue: c.flexValue ?? null,
                flipIcon: c.flipIcon,
              });
              return (
                <div key={i} className="panel flex items-center gap-3 p-3">
                  <span className="cardwrap shrink-0" style={{ "--k": 0.38 } as never}>
                    <CardView
                      face={c.face}
                      flipDark={c.dark}
                      flipLight={c.light}
                      flex={c.flexColor || c.flexValue || c.flipIcon ? { flexColor: (c.flexColor ?? null) as never, flexValue: c.flexValue ?? null, flipIcon: c.flipIcon } : null}
                      useFlexArt={c.variant === "flex"}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold capitalize">{info.title}</span>
                      <span className="text-[11px] text-[var(--acc)]">{c.count}</span>
                    </span>
                    <span className="block text-[12px] text-[var(--mut)] leading-snug mt-1">{info.text}</span>
                  </span>
                </div>
              );
            })}
          </div>

          <h3 className="tabfont text-[14px] mt-8 mb-3">Optional house rules</h3>
          <div className="panel">
            {[...GENERAL_RULES, ...VARIANT_RULES[v]].map((r, i) => (
              <div key={r.key} className={`px-4 py-2.5 ${i > 0 ? "border-t border-[var(--line)]" : ""}`}>
                <span className="text-[13px] font-medium">{r.name}</span>
                <span className="block text-[12px] text-[var(--mut)] leading-snug mt-0.5">{r.desc}</span>
              </div>
            ))}
          </div>

          <p className="text-[12px] text-[var(--mut)] mt-6">Hold any card during a game to see what it does.</p>
        </section>
      </div>
    </main>
  );
}
