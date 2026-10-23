"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { deriveAccountIdV2, deriveKey, encrypt, decrypt } from "@/lib/crypto";
import {
  MIGRATION_NOTICE_DELAY_MS,
  normalizeUsername,
  STORAGE_V2_ENABLED,
} from "@/lib/storage";
import dynamic from "next/dynamic";

const MilkdownEditor = dynamic(() => import("./MilkdownEditor"), {
  ssr: false,
});

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditorPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [loading, setLoading] = useState(true);
  const [wordCount, setWordCount] = useState(0);
  const [showDestroy, setShowDestroy] = useState(false);
  const [destroyPw, setDestroyPw] = useState("");
  const [destroyError, setDestroyError] = useState("");
  const [destroying, setDestroying] = useState(false);
  const [showMigrationNotice, setShowMigrationNotice] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const userRef = useRef<string>("");
  const normalizedUserRef = useRef<string>("");
  const accountIdRef = useRef<string>("");
  const hadLegacyDataRef = useRef(false);
  const migrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const user = sessionStorage.getItem("txt-note-id") ?? sessionStorage.getItem("txt-user");
    const pw = sessionStorage.getItem("txt-pw");
    const sessionId = sessionStorage.getItem("txt-id");
    if (!user || !pw) {
      router.replace("/");
      return;
    }
    userRef.current = user;
    normalizedUserRef.current = normalizeUsername(user);
    if (sessionId) accountIdRef.current = sessionId;
    init(user, pw, sessionId ?? undefined);
    return () => {
      if (migrationTimerRef.current) clearTimeout(migrationTimerRef.current);
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function init(user: string, pw: string, sessionId?: string) {
    const normalizedUser = normalizeUsername(user);
    const key = await deriveKey(pw, normalizedUser);
    keyRef.current = key;
    const accountId = STORAGE_V2_ENABLED
      ? (sessionId || await deriveAccountIdV2(normalizedUser, pw))
      : "";
    accountIdRef.current = accountId;
    if (accountId) sessionStorage.setItem("txt-id", accountId);

    let data: string | null = null;
    let source: "v2" | "legacy" | null = null;

    if (STORAGE_V2_ENABLED && accountId) {
      const v2Res = await fetch(`/api/notes?id=${encodeURIComponent(accountId)}`);
      const v2Json = await v2Res.json();
      data = v2Json.data;
      source = v2Json.source ?? "v2";
    }

    if (!data) {
      const legacyRes = await fetch(`/api/notes?user=${encodeURIComponent(user)}`);
      const legacyJson = await legacyRes.json();
      data = legacyJson.data;
      source = legacyJson.source ?? "legacy";
      if (data) hadLegacyDataRef.current = true;
    }

    if (data) {
      let decrypted = "";
      try {
        decrypted = await decrypt(data, key);
      } catch {
        sessionStorage.clear();
        router.replace("/");
        return;
      }

      setText(decrypted);
      updateWordCount(decrypted);

      if (STORAGE_V2_ENABLED && accountId && source === "legacy") {
        if (migrationTimerRef.current) clearTimeout(migrationTimerRef.current);
        migrationTimerRef.current = setTimeout(
          () => setShowMigrationNotice(true),
          MIGRATION_NOTICE_DELAY_MS
        );
        try {
          const migrateRes = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: accountId, data }),
          });
          if (migrateRes.ok) {
            const deleteRes = await fetch("/api/notes", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user }),
            });
            if (deleteRes.ok) hadLegacyDataRef.current = false;
          }
        } catch {
          // Best-effort migration.
        } finally {
          if (migrationTimerRef.current) clearTimeout(migrationTimerRef.current);
          migrationTimerRef.current = null;
          setShowMigrationNotice(false);
        }
      }
    }
    setLoading(false);
  }

  function updateWordCount(t: string) {
    const words = t.trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
  }

  const save = useCallback(async (val: string) => {
    if (!keyRef.current || !userRef.current) return;
    setStatus("saving");
    try {
      const encrypted = await encrypt(val, keyRef.current);
      const body = STORAGE_V2_ENABLED && accountIdRef.current
        ? { id: accountIdRef.current, data: encrypted }
        : { user: userRef.current, data: encrypted };
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, []);

  function handleChange(val: string) {
    setText(val);
    updateWordCount(val);
    setStatus("idle");
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => save(val), 900);
  }

  function handleLogout() {
    sessionStorage.clear();
    router.replace("/");
  }

  async function handleDestroy(e: React.FormEvent) {
    e.preventDefault();
    if (!destroyPw) return;
    setDestroyError("");
    setDestroying(true);

    try {
      // Re-derive key and verify password by decrypting existing notes
      const testKey = await deriveKey(destroyPw, normalizedUserRef.current);
      let data: string | null = null;

      if (STORAGE_V2_ENABLED && accountIdRef.current) {
        const v2Res = await fetch(`/api/notes?id=${encodeURIComponent(accountIdRef.current)}`);
        const v2Json = await v2Res.json();
        data = v2Json.data;
      }

      if (!data) {
        const legacyRes = await fetch(`/api/notes?user=${encodeURIComponent(userRef.current)}`);
        const legacyJson = await legacyRes.json();
        data = legacyJson.data;
      }

      if (data) {
        try {
          await decrypt(data, testKey);
        } catch {
          setDestroyError("Wrong password.");
          setDestroying(false);
          return;
        }
      }

      // Password verified — delete the blob
      if (STORAGE_V2_ENABLED && accountIdRef.current) {
        await fetch("/api/notes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: accountIdRef.current }),
        });
      }
      if (hadLegacyDataRef.current) {
        const legacyDeleteRes = await fetch("/api/notes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: userRef.current }),
        });
        if (!legacyDeleteRes.ok) {
          setDestroyError("V2 data was deleted, but legacy data still exists. Please retry delete to finish cleanup.");
          setDestroying(false);
          return;
        }
      }

      sessionStorage.clear();
      router.replace("/");
    } catch {
      setDestroyError("Something went wrong.");
      setDestroying(false);
    }
  }

  if (loading) {
    return (
    <main className="min-h-dvh flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <span className="size-1.5 rounded-full bg-white/30 animate-pulse" />
      </main>
    );
  }

  const dotClass =
    status === "saved"
      ? "bg-emerald-400/50"
      : status === "saving"
      ? "bg-white/40 animate-pulse"
      : status === "error"
      ? "bg-red-500/60"
      : "bg-white/[0.08]";

  return (
    <main className="min-h-dvh flex flex-col" style={{ background: "var(--bg)", color: "var(--text-primary)" }}>
      <header className="h-12 px-5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={handleLogout}
          className="text-[13px] font-medium tracking-[-0.04em] transition-colors duration-200"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}  
        >
          txt
        </button>

        <div className="flex items-center gap-4">
      <span className="text-[11px] tabular-nums tracking-tight" style={{ color: "var(--text-faint)" }}>
            {wordCount}
          </span>
          <span
            className={`size-1.5 rounded-full transition-colors duration-300 ${dotClass}`}
            aria-label={status}
          />
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
          <button
            onClick={() => { setShowDestroy(true); setDestroyPw(""); setDestroyError(""); }}
            className="text-[11px] transition-colors duration-200 tracking-[-0.01em]"
            style={{ color: "var(--text-faint)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(239,68,68,0.7)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-faint)")}  
          >
            destroy
          </button>
          <button
            onClick={handleLogout}
            aria-label="Lock"
            className="transition-colors duration-200"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="flex-1 w-full max-w-[680px] mx-auto px-6 py-12"
        style={{ minHeight: "calc(100dvh - 96px)" }}
      >
        <MilkdownEditor defaultValue={text} onChange={handleChange} />
      </div>

      {showMigrationNotice && (
        <footer className="px-5 h-12 flex items-center justify-end" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="text-[11px] tracking-[-0.01em]" style={{ color: "var(--text-faint)" }}>
            upgrading…
          </span>
        </footer>
      )}

      {showDestroy && (
        <div
          className="fixed inset-0 backdrop-blur-md flex items-center justify-center px-6 z-50"
          style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDestroy(false); }}
        >
          <div className="w-full max-w-[320px] rounded-xl p-6 flex flex-col gap-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)]" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] font-medium tracking-[-0.02em]" style={{ color: "var(--text-primary)" }}>
                destroy account
              </p>
              <p className="text-[12px] leading-[1.55] tracking-[-0.01em]" style={{ color: "var(--text-muted)" }}>
                Permanently deletes all notes and removes your account. No recovery.
              </p>
            </div>

            <form onSubmit={handleDestroy} className="flex flex-col gap-3">
              <input
                type="password"
                placeholder="password"
                value={destroyPw}
                onChange={(e) => setDestroyPw(e.target.value)}
                autoFocus
                className="w-full h-11 rounded-lg px-3.5 text-[14px] tracking-[-0.01em] transition-colors duration-200"
                style={{ background: "var(--border)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              />

              <div className="min-h-[16px]">
                {destroyError && (
                  <p className="text-[11px] text-red-400/60 tracking-[-0.01em]">{destroyError}</p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDestroy(false)}
                  className="flex-1 h-11 rounded-lg text-[13px] text-white/50 hover:text-white bg-white/[0.04] hover:bg-white/[0.06] transition-colors duration-200"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={destroying || !destroyPw}
                  className="flex-1 h-11 rounded-lg text-[13px] font-medium text-white bg-red-600/80 hover:bg-red-600 transition-colors duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {destroying ? "destroying…" : "destroy"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
