// 運営が、メールアドレスとお店を紐付けて招待メールを送る
import { admin, asUser, currentUser, handle, HttpError, json, safeReturn } from "../_shared/util.ts";

Deno.serve(handle(async (req) => {
  await currentUser(req);
  const { data: isAdmin } = await asUser(req).rpc("is_admin");
  if (!isAdmin) throw new HttpError(403, "運営者だけが招待できます");

  const { shop_id, email: raw, redirect_to } = await req.json();
  const email = String(raw ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "メールアドレスの形が正しくありません");
  const { data: shop } = await admin.from("shops").select("id,name").eq("id", shop_id).maybeSingle();
  if (!shop) throw new HttpError(404, "お店が見つかりません");
  const redirectTo = safeReturn(redirect_to);

  // 新しい人には招待メール。すでに登録済みの人には、ログイン用のリンクを送る。
  let userId: string | undefined;
  const inv = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_shop: shop.name } });
  if (inv.data?.user) userId = inv.data.user.id;
  else {
    for (let page = 1; !userId && page < 50; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (data.users.length < 1000) break;
    }
    if (!userId) throw new HttpError(500, inv.error?.message ?? "招待できませんでした");
    const link = await admin.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
    if (link.error) console.warn("login link:", link.error.message);
  }

  const { error } = await admin.from("shop_members").upsert({ shop_id, user_id: userId, email }, { onConflict: "shop_id,user_id" });
  if (error) throw error;
  return json({ ok: true });
}));
