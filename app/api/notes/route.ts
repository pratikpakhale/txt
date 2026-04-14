import { put, list, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

function slugify(username: string) {
  return username.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

const OPAQUE_ID_V2_REGEX = /^[A-Za-z0-9_-]{43}$/;

function isOpaqueId(id: string) {
  return OPAQUE_ID_V2_REGEX.test(id);
}

function v2Key(id: string) {
  return `notes/v2/${id}.enc`;
}

function legacyKey(user: string) {
  return `notes/${slugify(user)}.enc`;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const user = req.nextUrl.searchParams.get("user");
  if (!id && !user) {
    return NextResponse.json({ error: "Missing id or user" }, { status: 400 });
  }

  if (id && !isOpaqueId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const key = id ? v2Key(id) : legacyKey(user!);
  const source = id ? "v2" : "legacy";
  try {
    const { blobs } = await list({ prefix: key });
    if (!blobs.length) return NextResponse.json({ data: null, source });
    const res = await fetch(blobs[0].url);
    const data = await res.text();
    return NextResponse.json({ data, source });
  } catch {
    return NextResponse.json({ data: null, source });
  }
}

export async function POST(req: NextRequest) {
  const { id, user, data } = await req.json();
  if ((!id && !user) || data === undefined) {
    return NextResponse.json({ error: "Missing id/user or data" }, { status: 400 });
  }

  if (id && !isOpaqueId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const key = id ? v2Key(id) : legacyKey(user);
  const source = id ? "v2" : "legacy";

  // Delete old blob first
  try {
    const { blobs } = await list({ prefix: key });
    if (blobs.length) await del(blobs.map((b) => b.url));
  } catch {}

  await put(key, data, {
    access: "public",
    contentType: "text/plain",
  });

  return NextResponse.json({ ok: true, source });
}

export async function DELETE(req: NextRequest) {
  const { id, user } = await req.json();
  if (!id && !user) {
    return NextResponse.json({ error: "Missing id or user" }, { status: 400 });
  }

  if (id && !isOpaqueId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const key = id ? v2Key(id) : legacyKey(user);
  const source = id ? "v2" : "legacy";
  try {
    const { blobs } = await list({ prefix: key });
    if (blobs.length) await del(blobs.map((b) => b.url));
    return NextResponse.json({ ok: true, source });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
