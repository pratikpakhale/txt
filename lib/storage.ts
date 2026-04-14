export const STORAGE_V2_ENABLED = process.env.NEXT_PUBLIC_STORAGE_V2 !== "0";
export const MIGRATION_NOTICE_DELAY_MS = 500;

export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}
