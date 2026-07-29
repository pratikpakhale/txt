"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

export default function HomePage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [noteId, setNoteId] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = noteId.trim();
    if (!id) return;
    router.push(`/${encodeURIComponent(id)}`);
  }

  const inputClass =
    "w-full h-11 rounded-lg px-3.5 text-[14px] tracking-[-0.01em] transition-colors duration-200";

  return (
    <main className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-[300px] flex flex-col gap-10">
        <header className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h1 className="text-[26px] font-medium tracking-[-0.04em] leading-none" style={{ color: "var(--text-primary)" }}>
              txt
            </h1>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              className="transition-colors duration-200"
              style={{ color: "var(--text-muted)" }}
            >
              {theme === "dark" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              )}
            </button>
          </div>
          <p className="text-[12px] tracking-[-0.01em]" style={{ color: "var(--text-muted)" }}>
            open your encrypted page
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="page ID"
            value={noteId}
            onChange={(e) => setNoteId(e.target.value)}
            autoComplete="off"
            autoFocus
            className={inputClass}
            style={{ background: "var(--border)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
          />

          <button
            type="submit"
            disabled={!noteId.trim()}
            className="mt-2 w-full h-11 rounded-lg text-[13px] font-medium tracking-[-0.01em] transition-colors duration-200 disabled:cursor-not-allowed"
            style={{ background: "var(--text-primary)", color: "var(--bg)" }}
          >
            Continue
          </button>

          <p className="text-[11px] mt-1 tracking-[-0.01em]" style={{ color: "var(--text-faint)" }}>
            Existing page: enter password next. New page: set one.
          </p>
        </form>
      </div>
    </main>
  );
}
