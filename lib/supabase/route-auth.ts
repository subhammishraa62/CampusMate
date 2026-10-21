import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Resolve the current user for API routes. Never use a service-role key here. */
export async function requireUser() {
  const supabase = await createClient();
  if (!supabase) {
    return {
      error: NextResponse.json(
        { error: "Supabase is not configured. Add the public URL and key from .env.example to .env.local." },
        { status: 503 },
      ),
    } as const;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      error: NextResponse.json({ error: "Sign in to use this feature." }, { status: 401 }),
    } as const;
  }

  return { supabase, user: data.user } as const;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  return body as Record<string, unknown>;
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export function cleanText(value: unknown, maxLength: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

export function jsonNoStore(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(payload, { ...init, headers });
}
