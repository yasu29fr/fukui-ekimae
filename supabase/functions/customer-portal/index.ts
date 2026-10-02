// お支払い方法の変更・解約：Stripe のカスタマーポータルの URL を返す
import { admin, assertMember, currentUser, handle, HttpError, json, safeReturn, stripe } from "../_shared/util.ts";

Deno.serve(handle(async (req) => {
  const user = await currentUser(req);
  const { shop_id, return_url } = await req.json();
  await assertMember(user.id, shop_id);
  const { data: sub } = await admin.from("subscriptions").select("stripe_customer_id").eq("shop_id", shop_id).maybeSingle();
  if (!sub) throw new HttpError(404, "Stripe のご契約が見つかりません");
  const portal = await stripe().billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: safeReturn(return_url) });
  return json({ url: portal.url });
}));
