// オーナー画面・運営画面で共通の部品（Supabase への接続、画像の縮小など）
import { createDemoClient, demoUrls } from "./demo-sb.js";

export const cfg = window.FUKUFUKU_CONFIG || {};
// ?demo=login / free / owner / admin のときは、見本のデータで画面だけ動かす（保存はされない）
export const demo = new URLSearchParams(location.search).get("demo");
const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
export const ready = hasDb || Boolean(demo);
// 接続先が設定されているときだけ supabase-js を読み込む
const { createClient } = hasDb && !demo ? await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm") : {};
export const sb = demo ? createDemoClient(demo) : hasDb ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
if (demo) {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.innerHTML = "<b>見本</b>の画面です（保存はされません）";
  document.body.prepend(bar);
}

export const $ = (s, root = document) => root.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ZONES = { ekimae: "駅前", katamachi: "片町" };
export const PLANS = { free: "無料", monthly: "有料（月額）", yearly: "有料（年額）" };
export const LINK_KINDS = {
  web: "ホームページ", tabelog: "食べログ", hotpepper: "ホットペッパー", gmap: "Googleマップ", x: "X",
  threads: "Threads", tiktok: "TikTok", line: "LINE公式", reserve: "予約ページ", other: "その他",
};

export function photoUrl(path) {
  if (demoUrls.has(path)) return demoUrls.get(path);
  if (/^(\.\.?\/|https?:)/.test(path)) return path;
  return `${cfg.supabaseUrl}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function isPaid(shop) {
  return shop.plan !== "free" && (!shop.plan_until || new Date(shop.plan_until) > new Date()) && !shop.is_hidden;
}

export function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// スマホの写真を長辺1600pxの WebP にする。canvas を通すので撮影場所などの情報（EXIF）は残らない。
export async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", quality));
  if (blob && blob.type === "image/webp") return blob;
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));   // WebP 非対応の古い Safari
}

// Edge Function を呼ぶ（ログイン中のトークンを付けて）
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return data;
}

export function toast(msg, kind = "") {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
  el.textContent = msg; el.className = `toast show ${kind}`;
  clearTimeout(el._t); el._t = setTimeout(() => (el.className = "toast"), 3200);
}

// メールのリンクでログインする画面（招待済みの人だけ。新規登録はさせない）
export function renderLogin(root, title) {
  root.innerHTML = `
    <section class="panel narrow login-card">
      <div class="emblem-lg" aria-hidden="true">ふ</div>
      <p class="en">LOGIN</p>
      <h1>${esc(title)}</h1>
      <p class="muted">登録済みのメールアドレスに、ログイン用のリンクをお送りします。パスワードはいりません。</p>
      <div class="login-steps">
        <div><b>01</b>アドレスを入力</div>
        <div><b>02</b>メールを開く</div>
        <div><b>03</b>リンクで入る</div>
      </div>
      <form id="login-form">
        <label>メールアドレス<input type="email" name="email" required autocomplete="email" placeholder="shop@example.com" /></label>
        <button class="btn" type="submit">ログイン用のリンクを送る</button>
        <p class="form-msg" id="login-msg" role="status"></p>
      </form>
      <p class="muted small">掲載のお申し込み・メールアドレスの登録は、<a href="../#inquiry">お問い合わせ</a>から運営にご連絡ください。</p>
    </section>`;
  $("#login-form", root).addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#login-msg", root);
    msg.textContent = "送信しています…";
    const { error } = await sb.auth.signInWithOtp({
      email: e.target.email.value.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    msg.textContent = error
      ? "送れませんでした。登録済みのメールアドレスか、ご確認ください。"
      : "メールを送りました。届いたリンクを押してください（数分かかることがあります）。";
  });
}
