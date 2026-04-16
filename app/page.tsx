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

  const inputClass =
    "w-full h-11 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3.5 text-[14px] text-white tracking-[-0.01em] placeholder:text-white/20 focus:border-white/20 transition-colors duration-200";

  return (
    <main className="min-h-dvh bg-[#0d0b09] flex items-center justify-center px-6">
      <div className="w-full max-w-[300px] flex flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-[26px] font-medium tracking-[-0.04em] text-white leading-none">
            txt
          </h1>
          <p className="text-[12px] text-white/30 tracking-[-0.01em]">
            encrypted notes
          </p>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            className={inputClass}
          />
          <input
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="mt-2 w-full h-11 bg-white text-[#0d0b09] rounded-lg text-[13px] font-medium tracking-[-0.01em] hover:bg-white/90 transition-colors duration-200 disabled:bg-white/[0.06] disabled:text-white/30 disabled:cursor-not-allowed"
          >
            {loading
              ? step === "deriving"
                ? "Deriving key…"
                : "Unlocking…"
              : "Continue"}
          </button>

          <div className="min-h-[16px] mt-1">
            {error && (
              <p className="text-[11px] text-red-400/60 tracking-[-0.01em]">{error}</p>
            )}
            {!error && showMigrationNotice && (
              <p className="text-[11px] text-white/20 tracking-[-0.01em]">Upgrading secure storage…</p>
            )}
          </div>
        </form>
      </div>
    </main>
  );
}
