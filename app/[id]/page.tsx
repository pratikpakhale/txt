"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { deriveAccountIdV2, deriveKey, decrypt } from "@/lib/crypto";
import { MIGRATION_NOTICE_DELAY_MS, normalizeUsername, STORAGE_V2_ENABLED } from "@/lib/storage";

type ExistingState = "checking" | "existing" | "new" | "unknown";

export default function IdLoginPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "deriving">("idle");
  const [existingState, setExistingState] = useState<ExistingState>("checking");
  const [showMigrationNotice, setShowMigrationNotice] = useState(false);
  const migrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteId = (params?.id || "").trim();

  useEffect(() => () => {
    if (migrationTimerRef.current) clearTimeout(migrationTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkIdExists() {
      if (!noteId) {
        setExistingState("unknown");
        return;
      }

      setExistingState("checking");
      try {
        const res = await fetch(`/api/notes?user=${encodeURIComponent(noteId)}`);
        const json = await res.json();
        if (cancelled) return;
        setExistingState(json.data ? "existing" : "new");
      } catch {
        if (cancelled) return;
        setExistingState("unknown");
      }
    }

    void checkIdExists();

    return () => {
      cancelled = true;
    };
  }, [noteId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!noteId || !password) return;

    const normalizedId = normalizeUsername(noteId);
    setError("");
    setLoading(true);
    setStep("deriving");
    setShowMigrationNotice(false);

    try {
      const key = await deriveKey(password, normalizedId);
      const accountId = STORAGE_V2_ENABLED
        ? await deriveAccountIdV2(normalizedId, password)
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
        const legacyRes = await fetch(`/api/notes?user=${encodeURIComponent(noteId)}`);
        const legacyJson = await legacyRes.json();
        data = legacyJson.data;
        source = legacyJson.source ?? "legacy";
      }

      if (data) {
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
                body: JSON.stringify({ user: noteId }),
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

      sessionStorage.setItem("txt-note-id", noteId);
      sessionStorage.setItem("txt-user", noteId);
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
    "w-full h-11 rounded-lg px-3.5 text-[14px] tracking-[-0.01em] transition-colors duration-200";

  const title = existingState === "existing" ? "Enter password" : "Set password";
  const subtitle =
    existingState === "existing"
      ? "This page already exists."
      : existingState === "new"
      ? "New page. This password becomes your key."
      : "Use a password to unlock or create this page.";

  if (!noteId) {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          Invalid page ID.
        </p>
      </main>
    );
  }

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
            /{noteId}
          </p>
        </header>

        {existingState === "checking" ? (
          <p className="text-[12px] tracking-[-0.01em]" style={{ color: "var(--text-faint)" }}>
            Checking page…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <p className="text-[12px] tracking-[-0.01em]" style={{ color: "var(--text-muted)" }}>
              {title}
            </p>
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={existingState === "existing" ? "current-password" : "new-password"}
              autoFocus
              className={inputClass}
              style={{ background: "var(--border)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            />

            <button
              type="submit"
              disabled={loading || !password}
              className="mt-2 w-full h-11 rounded-lg text-[13px] font-medium tracking-[-0.01em] transition-colors duration-200 disabled:cursor-not-allowed"
              style={{ background: "var(--text-primary)", color: "var(--bg)" }}
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
                <p className="text-[11px] tracking-[-0.01em]" style={{ color: "var(--text-faint)" }}>Upgrading secure storage…</p>
              )}
            </div>

            <p className="text-[11px] tracking-[-0.01em]" style={{ color: "var(--text-faint)" }}>
              {subtitle}
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
