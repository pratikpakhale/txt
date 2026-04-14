"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deriveAccountIdV2, deriveKey, decrypt } from "@/lib/crypto";
import { MIGRATION_NOTICE_DELAY_MS, normalizeUsername, STORAGE_V2_ENABLED } from "@/lib/storage";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "deriving">("idle");
  const [showMigrationNotice, setShowMigrationNotice] = useState(false);
  const migrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (migrationTimerRef.current) clearTimeout(migrationTimerRef.current);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    const inputUsername = username.trim();
    const normalizedUsername = normalizeUsername(inputUsername);
    setError("");
    setLoading(true);
    setStep("deriving");
    setShowMigrationNotice(false);

    try {
      const key = await deriveKey(password, normalizedUsername);
      const accountId = STORAGE_V2_ENABLED
        ? await deriveAccountIdV2(normalizedUsername, password)
        : null;

      let source: "v2" | "legacy" | null = null;
      let data: string | null = null;

      if (STORAGE_V2_ENABLED && accountId) {
        const v2Res = await fetch(`/api/notes?id=${encodeURIComponent(accountId)}`);
        const v2Json = await v2Res.json();
        data = v2Json.data;
        source = v2Json.source ?? "v2";
      }

      if (!data) {
        const legacyRes = await fetch(`/api/notes?user=${encodeURIComponent(inputUsername)}`);
        const legacyJson = await legacyRes.json();
        data = legacyJson.data;
        source = legacyJson.source ?? "legacy";
      }

      if (data) {
        // Existing user — try to decrypt
        try {
          await decrypt(data, key);
        } catch {
          setError("Wrong password. No way to recover.");
          setLoading(false);
          setStep("idle");
          return;
        }

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
              await fetch("/api/notes", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user: inputUsername }),
              });
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

      // Store session
      sessionStorage.setItem("txt-user", inputUsername);
      sessionStorage.setItem("txt-pw", password);
      if (accountId) {
        sessionStorage.setItem("txt-id", accountId);
      } else {
        sessionStorage.removeItem("txt-id");
      }
      router.push("/editor");
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
      setStep("idle");
    }
  }

  return (
    <main className="min-h-screen bg-[#0b0b0b] flex items-center justify-center px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-8">
          <div className="w-9 h-9 rounded-xl bg-white/8 border border-white/10 flex items-center justify-center mb-4">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight">txt</h1>
          <p className="text-[13px] text-white/40 mt-1.5 leading-relaxed">
            End-to-end encrypted notes.
            <br />
            Your password is your key.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-3 text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition-all"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-white/[0.04] border border-white/[0.1] rounded-xl px-4 py-3 text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition-all"
            />
          </div>

          {error && (
            <p className="text-[13px] text-red-400/80 px-1">{error}</p>
          )}
          {showMigrationNotice && (
            <p className="text-[12px] text-white/40 px-1">Upgrading secure storage…</p>
          )}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="mt-1 w-full bg-white text-[#0c0c0c] rounded-xl py-3 text-[14px] font-semibold hover:bg-white/90 transition-all disabled:opacity-25 disabled:cursor-not-allowed"
          >
            {loading
              ? step === "deriving"
                ? "Deriving key…"
                : "Unlocking…"
              : "Continue →"}
          </button>
        </form>

        <p className="text-[12px] text-white/25 text-center mt-7 leading-relaxed">
          New user? Just enter a username and password.<br />
          No account creation needed.
        </p>
      </div>
    </main>
  );
}
