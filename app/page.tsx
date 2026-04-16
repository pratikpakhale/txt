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
    <main className="min-h-screen bg-[#080808] flex items-center justify-center px-6">
      <div className="w-full max-w-[320px] flex flex-col gap-6">
        <h1
          className="text-[26px] font-medium tracking-[-0.05em] text-white"
          style={{ fontFamily: "var(--font-geist-sans)" }}
        >
          txt
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <input
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-4 py-[11px] text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
            />
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-4 py-[11px] text-[14px] text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full bg-white text-[#080808] rounded-lg py-[11px] text-[14px] font-medium hover:bg-white/90 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          >
            {loading
              ? step === "deriving"
                ? "Deriving key…"
                : "Unlocking…"
              : "Continue"}
          </button>

          {error && (
            <p className="text-[12px] text-red-400/70">{error}</p>
          )}
          {showMigrationNotice && (
            <p className="text-[11px] text-white/25">Upgrading secure storage…</p>
          )}
        </form>
      </div>
    </main>
  );
}
