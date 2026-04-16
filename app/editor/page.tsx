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
      ? "bg-emerald-400"
      : status === "saving"
      ? "bg-white animate-pulse"
      : status === "error"
      ? "bg-red-500"
      : "bg-white/20";

  return (
    <main className="min-h-screen bg-[#080808] flex flex-col">
      <header className="flex items-center justify-between px-8 py-5">
        <span
          className="text-[13px] text-white/30"
          style={{ fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          txt
        </span>

        <div className="flex items-center gap-5">
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${dotClass}`}
            aria-label={status}
          />
          <span className="text-[12px] text-white/30 tabular-nums">{wordCount}</span>
          <button
            onClick={handleLogout}
            aria-label="Lock"
            className="text-white/30 hover:text-white/70 transition-colors duration-200"
          >
            <svg
              width="15"
              height="15"
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

      <div className="flex-1 flex flex-col w-full max-w-2xl mx-auto px-6 pb-10">
        <textarea
          className="flex-1 w-full bg-transparent font-mono text-[15px] text-white/75 leading-[1.9] resize-none focus:outline-none placeholder:text-white/15"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          autoFocus
          style={{ minHeight: "calc(100vh - 180px)", fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
        />
      </div>

      <footer className="text-center pb-6 px-6">
        {showMigrationNotice && (
          <p className="text-[11px] text-white/25 mb-2 tracking-wide">Upgrading secure storage…</p>
        )}
        <p className="text-[10.5px] text-white/10 tracking-wide">
          AES-256-GCM · encrypted in your browser · server sees nothing
        </p>
        <button
          onClick={() => { setShowDestroy(true); setDestroyPw(""); setDestroyError(""); }}
          className="mt-3 text-[10.5px] text-red-950 hover:text-red-600 transition-colors duration-200"
        >
          destroy
        </button>
      </footer>

      {showDestroy && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center px-6 z-50">
          <div className="w-full max-w-[340px] bg-[#0d0d0d] border border-white/[0.06] rounded-2xl p-6">
            <p className="text-[13px] text-red-500/80 mb-1.5" style={{ fontWeight: 500 }}>
              destroy account
            </p>
            <p className="text-[12.5px] text-white/35 leading-relaxed mb-5">
              Permanently deletes all notes and removes your account. No recovery.
            </p>

            <form onSubmit={handleDestroy} className="flex flex-col gap-2.5">
              <input
                type="password"
                placeholder="password"
                value={destroyPw}
                onChange={(e) => setDestroyPw(e.target.value)}
                autoFocus
                className="w-full bg-white/[0.025] border border-white/[0.07] rounded-xl px-4 py-3 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-red-900/60 transition-all duration-200"
              />

              {destroyError && (
                <p className="text-[12px] text-red-500/60 px-1">{destroyError}</p>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowDestroy(false)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] text-white/45 hover:text-white/70 bg-white/[0.03] hover:bg-white/[0.06] transition-all duration-200"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={destroying || !destroyPw}
                  className="flex-1 py-2.5 rounded-xl text-[13px] text-red-400/90 bg-red-950/40 hover:bg-red-950/70 border border-red-900/30 transition-all duration-200 disabled:opacity-25 disabled:cursor-not-allowed"
                  style={{ fontWeight: 500 }}
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
