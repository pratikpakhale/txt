"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { deriveAccountIdV2, deriveKey, encrypt, decrypt } from "@/lib/crypto";
import {
  MIGRATION_NOTICE_DELAY_MS,
  normalizeUsername,
  STORAGE_V2_ENABLED,
} from "@/lib/storage";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export default function EditorPage() {
  const router = useRouter();
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
    const user = sessionStorage.getItem("txt-user");
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
      <main className="min-h-screen bg-[#080808] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
      </main>
    );
  }

  const dotClass =
    status === "saved"
      ? "bg-emerald-500/60"
      : status === "saving"
      ? "bg-white/40 animate-pulse"
      : status === "error"
      ? "bg-red-500/60"
      : "bg-white/10";

  return (
    <main className="min-h-screen bg-[#080808] flex flex-col">
      <header className="h-11 border-b border-white/[0.05] px-5 flex items-center justify-between">
        <span className="text-[13px] text-white/30 font-medium tracking-[-0.03em]">
          txt
        </span>

        <div className="flex items-center gap-3">
          <span className="text-[12px] text-white/20 tabular-nums">{wordCount}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${dotClass}`}
            aria-label={status}
          />
          <button
            onClick={handleLogout}
            aria-label="Lock"
            className="text-white/25 hover:text-white/50 transition-colors"
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

      <textarea
        className="flex-1 w-full max-w-[680px] mx-auto px-6 py-8 bg-transparent text-[15px] font-mono text-white/70 leading-[1.85] resize-none focus:outline-none placeholder:text-white/15"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        autoFocus
        style={{ minHeight: "calc(100vh - 44px)", fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
      />

      <footer className="text-center py-4">
        {showMigrationNotice && (
          <p className="text-[11px] text-white/25 mb-1 tracking-wide">Upgrading secure storage…</p>
        )}
        <p className="text-[11px] text-white/[0.08] tracking-wide">
          AES-256-GCM · encrypted in your browser · server sees nothing
        </p>
        <button
          onClick={() => { setShowDestroy(true); setDestroyPw(""); setDestroyError(""); }}
          className="mt-1 text-[11px] text-red-950 hover:text-red-600 transition-colors"
        >
          destroy
        </button>
      </footer>

      {showDestroy && (
        <div className="fixed inset-0 bg-[#080808]/85 backdrop-blur-sm flex items-center justify-center px-6 z-50">
          <div className="w-full max-w-[320px] bg-[#0c0c0c] border border-white/[0.06] rounded-lg p-6 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <p className="text-[13px] text-white/80 font-medium tracking-[-0.02em]">
                destroy account
              </p>
              <p className="text-[12px] text-white/30 leading-relaxed">
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
                className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-4 py-[11px] text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
              />

              {destroyError && (
                <p className="text-[12px] text-red-400/70">{destroyError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowDestroy(false)}
                  className="flex-1 py-[11px] rounded-lg text-[13px] text-white/50 hover:text-white/80 bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={destroying || !destroyPw}
                  className="flex-1 py-[11px] rounded-lg text-[13px] font-medium text-white bg-red-600 hover:bg-red-500 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
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
