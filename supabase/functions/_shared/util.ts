// Edge Functions で共通の部品
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// 管理者権限のクライアント（RLS を通らない。サーバー側だけで使う）
export const admin: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// 呼び出した人の権限で動くクライアント
export function asUser(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

export async function currentUser(req: Request) {
  const { data, error } = await asUser(req).auth.getUser();
  if (error || !data.user) throw new HttpError(401, "ログインしてください");
  return data.user;
}

export async function assertMember(userId: string, shopId: string) {
  const { data } = await admin.from("shop_members").select("shop_id").eq("shop_id", shopId).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(403, "このお店の管理者ではありません");
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function stripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "決済は準備中です（not configured）");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

// 「戻り先」URL は自分のサイトのものだけ受け付ける（よそへの転送に使われないように）
export function safeReturn(url: unknown): string {
  const site = Deno.env.get("SITE_URL") ?? "";
  if (typeof url === "string" && site && url.startsWith(site)) return url;
  if (!site) throw new HttpError(500, "SITE_URL が未設定です");
  return site.replace(/\/$/, "") + "/owner/";
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try { return await fn(req); }
    catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
  };
}
