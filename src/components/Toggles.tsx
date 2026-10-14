"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { initSoundPref, setSoundEnabled, soundEnabled, playSound } from "@/lib/sound";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const t = (document.documentElement.dataset.theme as "dark" | "light") || "dark";
    setTheme(t);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("uno-theme", next); } catch {}
    playSound("click");
  };
  if (!mounted) return <span className="iconbtn" aria-hidden />;
  return (
    <button className="iconbtn" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export function SoundToggle() {
  const [on, setOn] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    initSoundPref();
    setOn(soundEnabled());
    setMounted(true);
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
    if (next) playSound("click");
  };
  if (!mounted) return <span className="iconbtn" aria-hidden />;
  return (
    <button className="iconbtn" onClick={toggle} aria-label="Toggle sound" title="Toggle sound">
      {on ? <Volume2 size={16} /> : <VolumeX size={16} />}
    </button>
  );
}
