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
      <main className="min-h-screen bg-[#0c0c0c] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          <p className="text-[13px] text-white/30">Decrypting your notes…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0b0b0b] flex flex-col">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-white/[0.08] border border-white/10 flex items-center justify-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </div>
          <span className="text-[12px] text-white/45 font-medium">{userRef.current}</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-white/30">{wordCount} {wordCount === 1 ? "word" : "words"}</span>
            <span className="text-white/10">·</span>
            <span className={`text-[12px] font-medium transition-colors ${
              status === "saved" ? "text-emerald-400/75" :
              status === "saving" ? "text-white/30" :
              status === "error" ? "text-red-400/70" :
              "text-white/20"
            }`}>
              {status === "saved" ? "Saved" :
               status === "saving" ? "Saving…" :
               status === "error" ? "Error" : "·"}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="text-[12px] text-white/30 hover:text-white/60 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.06]"
          >
            Lock
          </button>
        </div>
      </header>

      {/* Editor */}
      <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 py-8">
        <textarea
          className="flex-1 w-full bg-transparent text-[15px] text-white/80 leading-[1.8] resize-none focus:outline-none placeholder:text-white/15 font-light"
          placeholder="Start writing…"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          autoFocus
          style={{ minHeight: "calc(100vh - 140px)" }}
        />
      </div>

      {/* Bottom hint */}
      <footer className="text-center pb-5">
        {showMigrationNotice && (
          <p className="text-[11px] text-white/35 mb-2 tracking-wide">Upgrading secure storage…</p>
        )}
        <p className="text-[11px] text-white/15 tracking-wide">
          AES-256-GCM · encrypted in your browser · server sees nothing
        </p>
        <button
          onClick={() => { setShowDestroy(true); setDestroyPw(""); setDestroyError(""); }}
          className="mt-3 text-[11px] text-red-900 hover:text-red-500 transition-colors"
        >
          Destroy account
        </button>
      </footer>

      {/* Destroy modal */}
      {showDestroy && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center px-6 z-50">
          <div className="w-full max-w-[340px] bg-[#111] border border-white/[0.08] rounded-2xl p-6">
            <div className="mb-5">
              <p className="text-[13px] font-semibold text-red-400 mb-1">Destroy account</p>
              <p className="text-[13px] text-white/40 leading-relaxed">
                This will permanently delete all your notes and remove your account.
                There is absolutely no recovery.
              </p>
            </div>

            <form onSubmit={handleDestroy} className="flex flex-col gap-3">
              <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl px-4 py-2.5">
                <p className="text-[11px] text-white/30 mb-0.5">Logged in as</p>
                <p className="text-[13px] text-white/70 font-mono">{userRef.current}</p>
              </div>

              <input
                type="password"
                placeholder="Enter your password to confirm"
                value={destroyPw}
                onChange={(e) => setDestroyPw(e.target.value)}
                autoFocus
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-3 text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-red-900 transition-all"
              />

              {destroyError && (
                <p className="text-[13px] text-red-400/80 px-1">{destroyError}</p>
              )}

              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setShowDestroy(false)}
                  className="flex-1 py-2.5 rounded-xl text-[13px] text-white/40 hover:text-white/60 bg-white/[0.05] hover:bg-white/[0.08] transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={destroying || !destroyPw}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-semibold text-red-400 bg-red-950/60 hover:bg-red-950 border border-red-900/40 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {destroying ? "Destroying…" : "Destroy forever"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
