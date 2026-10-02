// deno test supabase/functions/stripe-webhook/test.ts
// 偽の Stripe 通知（正しい署名つき）を作り、お店のプランが切り替わるかを確かめる。
import Stripe from "npm:stripe@17";
import { assertEquals } from "jsr:@std/assert@1";

Deno.env.set("STRIPE_SECRET_KEY", "sk_test_dummy");
Deno.env.set("STRIPE_WEBHOOK_SECRET", "whsec_test");
const { handler, applySubscription } = await import("./index.ts");

// supabase-js の from().upsert()/update().eq() だけを真似る記録係
function fakeDb() {
  const calls: { table: string; op: string; row: Record<string, unknown>; id?: string }[] = [];
  return {
    calls,
    from(table: string) {
      return {
        upsert: (row: Record<string, unknown>) => { calls.push({ table, op: "upsert", row }); return Promise.resolve({ error: null }); },
        update: (row: Record<string, unknown>) => ({ eq: (_c: string, id: string) => { calls.push({ table, op: "update", row, id }); return Promise.resolve({ error: null }); } }),
      };
    },
  };
}

const end = Math.floor(Date.UTC(2026, 10, 2) / 1000);
const sub = (status: string, interval: "month" | "year", withTopLevelEnd = false) => ({
  id: "sub_1", object: "subscription", status, customer: "cus_1", metadata: { shop_id: "shop-1" },
  ...(withTopLevelEnd ? { current_period_end: end } : {}),
  items: { data: [{ price: { recurring: { interval } }, current_period_end: end }] },
}) as unknown as Stripe.Subscription;

Deno.test("月額が有効になると monthly・期限は更新日+3日", async () => {
  const db = fakeDb();
  await applySubscription(sub("active", "month"), db as never);
  const shop = db.calls.find((c) => c.table === "shops")!;
  assertEquals(shop.row.plan, "monthly");
  assertEquals(shop.row.plan_until, new Date((end + 3 * 86400) * 1000).toISOString());
  assertEquals(db.calls[0].row.status, "active");
});

Deno.test("年額は yearly（古い API 版の current_period_end でも読める）", async () => {
  const db = fakeDb();
  await applySubscription(sub("active", "year", true), db as never);
  assertEquals(db.calls.find((c) => c.table === "shops")!.row.plan, "yearly");
});

Deno.test("支払い遅れ（past_due）の間は掲載を続ける", async () => {
  const db = fakeDb();
  await applySubscription(sub("past_due", "month"), db as never);
  assertEquals(db.calls.find((c) => c.table === "shops")!.row.plan, "monthly");
});

Deno.test("解約されたら free に戻る", async () => {
  const db = fakeDb();
  await applySubscription(sub("canceled", "month"), db as never);
  const shop = db.calls.find((c) => c.table === "shops")!;
  assertEquals(shop.row, { plan: "free", plan_until: null });
});

Deno.test("署名が正しい通知だけ受け付ける", async () => {
  const db = fakeDb();
  const stripe = new Stripe("sk_test_dummy", { httpClient: Stripe.createFetchHttpClient() });
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.deleted", data: { object: sub("canceled", "month") } });
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: "whsec_test", cryptoProvider: Stripe.createSubtleCryptoProvider() });
  const ok = await handler(new Request("http://x", { method: "POST", body: payload, headers: { "stripe-signature": header } }), db as never);
  assertEquals(ok.status, 200);
  assertEquals(db.calls.find((c) => c.table === "shops")!.row.plan, "free");

  const db2 = fakeDb();
  const bad = await handler(new Request("http://x", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=deadbeef" } }), db2 as never);
  assertEquals(bad.status, 400);
  assertEquals(db2.calls.length, 0);
});

Deno.test("shop_id のない契約は何もしない", async () => {
  const db = fakeDb();
  const s = sub("active", "month"); s.metadata = {};
  await applySubscription(s, db as never);
  assertEquals(db.calls.length, 0);
});
