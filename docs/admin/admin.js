// 運営管理画面：問い合わせ・更新依頼・店の編集・オーナー招待・写真の非表示
import { sb, ready, $, esc, ZONES, PLANS, photoUrl, isPaid, fmtDate, callFn, toast, renderLogin } from "../lib/common.js";

const root = $("#root");
const TOWNS = ["大手", "順化", "中央", "つくも", "照手", "手寄", "日之出"];
const GENRES = ["和食", "寿司・海鮮", "そば・うどん", "ラーメン", "焼肉・肉料理", "焼鳥・串", "居酒屋", "イタリアン・フレンチ",
  "中華", "アジア・各国料理", "カフェ・スイーツ", "洋食", "バー", "スナック・ラウンジ", "その他"];
let tab = "requests";

if (!ready) root.innerHTML = `<section class="panel narrow"><h1>Supabase が未設定です</h1><p class="muted">docs/config.js を設定してください。</p></section>`;
else {
  sb.auth.onAuthStateChange(async (_e, session) => {
    if (!session) return renderLogin(root, "運営管理にログイン");
    $("#logout").hidden = false;
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) return (root.innerHTML = `<section class="panel narrow"><h1>運営者ではありません</h1><p class="muted">${esc(session.user.email)} は運営者として登録されていません。</p></section>`);
    show();
  });
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
}

async function show() {
  const [{ count: nReq }, { count: nInq }] = await Promise.all([
    sb.from("update_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  root.innerHTML = `
    <div class="tabs" role="tablist">
      ${[["requests", `更新依頼（${nReq ?? 0}）`], ["inquiries", `問い合わせ（${nInq ?? 0}）`], ["shops", "店"], ["photos", "写真"]]
        .map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}
    </div>
    <div id="pane"></div>`;
  root.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; show(); } });
  ({ requests: showRequests, inquiries: showInquiries, shops: showShops, photos: showPhotos })[tab]($("#pane"));
}

async function showRequests(pane) {
  const { data } = await sb.from("update_requests").select("*, shops(name, slug, id)").order("status").order("created_at", { ascending: false }).limit(100);
  pane.innerHTML = `<section class="panel"><h2>更新依頼</h2>${data?.length ? `<ul class="list">${data.map((r) => `
    <li data-id="${r.id}">
      <div class="spread"><strong>${esc(r.shops?.name)}</strong><span class="small muted">${fmtDate(r.created_at)}</span></div>
      <p style="white-space:pre-wrap;margin:6px 0">${esc(r.body)}</p>
      ${r.status === "open" ? `<div class="row">
        <input data-note placeholder="オーナーへのひとこと（任意）" style="flex:1;min-width:180px" />
        <button class="btn" data-set="done">反映した</button><button class="btn-ghost" data-set="rejected">見送り</button>
        <button class="btn-ghost" data-open="${r.shop_id}">店を開く</button></div>`
        : `<span class="badge ${r.status === "done" ? "paid" : "off"}">${r.status === "done" ? "反映済み" : "見送り"}</span> <span class="small muted">${esc(r.admin_note)}</span>`}
    </li>`).join("")}</ul>` : '<p class="muted">依頼はありません。</p>'}</section>`;
  pane.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.open) { tab = "shops"; await show(); return openShop($("#pane"), b.dataset.open); }
    const li = b.closest("li");
    const { error } = await sb.from("update_requests").update({ status: b.dataset.set, admin_note: $("[data-note]", li).value.trim(), handled_at: new Date().toISOString() }).eq("id", li.dataset.id);
    error ? toast(error.message, "error") : show();
  });
}

async function showInquiries(pane) {
  const { data } = await sb.from("inquiries").select("*").order("status").order("created_at", { ascending: false }).limit(100);
  pane.innerHTML = `<section class="panel"><h2>掲載の問い合わせ</h2>${data?.length ? `<ul class="list">${data.map((r) => `
    <li data-id="${r.id}"><div class="spread"><strong>${esc(r.shop_name)}</strong><span class="small muted">${fmtDate(r.created_at)}</span></div>
      <p class="small">連絡先：${esc(r.contact)}</p><p style="white-space:pre-wrap;margin:4px 0">${esc(r.message)}</p>
      ${r.status === "open" ? '<button class="btn-ghost" data-done>対応済みにする</button>' : '<span class="badge paid">対応済み</span>'}</li>`).join("")}</ul>` : '<p class="muted">問い合わせはありません。</p>'}</section>`;
  pane.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-done]"); if (!b) return;
    await sb.from("inquiries").update({ status: "done" }).eq("id", b.closest("li").dataset.id); show();
  });
}

async function showShops(pane) {
  pane.innerHTML = `<section class="panel"><h2>店を探す</h2>
    <div class="row"><input id="shop-q" placeholder="店名で検索" style="flex:1" />
      <select id="shop-f"><option value="">すべて</option><option value="paid">有料</option><option value="hidden">非表示</option><option value="members">オーナーあり</option></select>
      <button class="btn-ghost" id="shop-new">店を追加</button></div>
    <div id="shop-results" style="margin-top:10px"></div></section><div id="shop-edit"></div>`;
  const run = async () => {
    let q = sb.from("shops").select("id,name,zone,town,genre,plan,plan_until,is_hidden,shop_members(email)").order("name").limit(50);
    const v = $("#shop-q").value.trim(), f = $("#shop-f").value;
    if (v) q = q.ilike("name", `%${v}%`);
    if (f === "paid") q = q.neq("plan", "free");
    if (f === "hidden") q = q.eq("is_hidden", true);
    const { data, error } = await q;
    if (error) return toast(error.message, "error");
    const rows = f === "members" ? data.filter((s) => s.shop_members.length) : data;
    $("#shop-results").innerHTML = `<table class="grid"><tbody>${rows.map((s) => `
      <tr><td><a href="#" data-open="${s.id}">${esc(s.name)}</a></td><td class="small">${esc(ZONES[s.zone])}・${esc(s.town)}</td>
      <td class="small">${isPaid(s) ? '<span class="badge paid">有料</span>' : ""}${s.is_hidden ? '<span class="badge off">非表示</span>' : ""}${s.shop_members.length ? ` 👤${s.shop_members.length}` : ""}</td></tr>`).join("")}</tbody></table>`;
  };
  let t; $("#shop-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
  $("#shop-f").addEventListener("change", run);
  $("#shop-results").addEventListener("click", (e) => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openShop(pane, a.dataset.open); } });
  $("#shop-new").addEventListener("click", () => openShop(pane, null));
  run();
}

async function openShop(pane, id) {
  const box = $("#shop-edit", pane) || pane;
  let s = { name: "", zone: "ekimae", town: "中央", category: "gourmet", genre: "その他", instagram: "", plan: "free", plan_until: null, is_hidden: false, address: "", tel: "", admin_note: "" };
  let members = [];
  if (id) {
    const r = await sb.from("shops").select("*").eq("id", id).single(); s = r.data;
    members = (await sb.from("shop_members").select("*").eq("shop_id", id)).data || [];
  }
  const opt = (list, v) => list.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  box.innerHTML = `<section class="panel">
    <h2>${id ? "店を編集" : "店を追加"}</h2>
    <form id="shop-form">
      <label>店名<input name="name" required value="${esc(s.name)}" /></label>
      <div class="row">
        <label>エリア<select name="zone"><option value="ekimae" ${s.zone === "ekimae" ? "selected" : ""}>駅前</option><option value="katamachi" ${s.zone === "katamachi" ? "selected" : ""}>片町</option></select></label>
        <label>町<select name="town">${opt(TOWNS, s.town)}</select></label>
        <label>区分<select name="category"><option value="gourmet" ${s.category === "gourmet" ? "selected" : ""}>グルメ</option><option value="night" ${s.category === "night" ? "selected" : ""}>夜のお店</option></select></label>
        <label>ジャンル<select name="genre">${opt(GENRES, s.genre)}</select></label>
      </div>
      <label>Instagram（@ のあと）<input name="instagram" value="${esc(s.instagram)}" /></label>
      <div class="row">
        <label>プラン<select name="plan">${Object.entries(PLANS).map(([k, v]) => `<option value="${k}" ${s.plan === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>有料の期限<input name="plan_until" type="date" value="${s.plan_until ? s.plan_until.slice(0, 10) : ""}" /></label>
        <label class="row" style="margin-top:18px"><input type="checkbox" name="is_hidden" ${s.is_hidden ? "checked" : ""} /> 非表示（掲載拒否・閉店など）</label>
      </div>
      <p class="muted small">Stripe で契約した店のプランと期限は自動で更新されます。手で変えるのは、特別に無償で有料にする場合などだけにしてください。</p>
      <h3>運営だけが見る情報</h3>
      <label>住所<input name="address" value="${esc(s.address)}" /></label>
      <label>電話<input name="tel" value="${esc(s.tel)}" /></label>
      <label>メモ<textarea name="admin_note" rows="3">${esc(s.admin_note)}</textarea></label>
      <button class="btn" type="submit">保存する</button>
      ${id ? `<a class="small" href="../#/shop/${encodeURIComponent(s.slug)}" target="_blank" style="margin-left:10px">公開ページ</a>` : ""}
    </form>
    ${id ? `<h3>オーナー（ログインできる人）</h3>
      <ul class="list">${members.map((m) => `<li class="spread"><span>${esc(m.email)} <span class="small muted">${fmtDate(m.invited_at)} 招待</span></span>
        <button class="icon-btn danger" data-unlink="${m.user_id}">紐付けを外す</button></li>`).join("") || '<li class="muted">まだいません。</li>'}</ul>
      <form id="invite-form" class="row" style="margin-top:10px;align-items:flex-end">
        <label style="flex:1;min-width:220px">メールアドレスを紐付けて招待<input type="email" name="email" required /></label>
        <button class="btn" type="submit">招待メールを送る</button></form>
      <p class="muted small">お店の公式アカウントの DM や店の電話で確認したアドレスだけを登録してください。招待されたメールのリンクを押すと、この店の管理画面に入れます。</p>` : ""}
  </section>`;
  box.scrollIntoView({ behavior: "smooth" });

  $("#shop-form", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const row = {
      name: f.name.value.trim(), zone: f.zone.value, town: f.town.value, category: f.category.value, genre: f.genre.value,
      instagram: f.instagram.value.trim().replace(/^@/, ""), plan: f.plan.value,
      plan_until: f.plan_until.value ? new Date(f.plan_until.value + "T23:59:59+09:00").toISOString() : null,
      is_hidden: f.is_hidden.checked, address: f.address.value.trim(), tel: f.tel.value.trim(), admin_note: f.admin_note.value,
    };
    if (row.instagram !== (s.instagram || "")) row.instagram_from = "admin";
    const res = id ? await sb.from("shops").update(row).eq("id", id) : await sb.from("shops").insert({ ...row, slug: "s" + crypto.randomUUID().slice(0, 8) }).select().single();
    if (res.error) return toast(res.error.message, "error");
    toast("保存しました。");
    if (!id) openShop(pane, res.data.id);
  });
  $("#invite-form", box)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      await callFn("invite-owner", { shop_id: id, email: e.target.email.value.trim(), redirect_to: location.origin + location.pathname.replace(/admin\/.*$/, "owner/") });
      toast("招待メールを送りました。"); openShop(pane, id);
    } catch (err) { toast("送れませんでした：" + err.message, "error"); btn.disabled = false; }
  });
  box.querySelectorAll("[data-unlink]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("このメールアドレスの紐付けを外しますか？")) return;
    await sb.from("shop_members").delete().eq("shop_id", id).eq("user_id", b.dataset.unlink); openShop(pane, id);
  }));
}

async function showPhotos(pane) {
  const { data } = await sb.from("shop_photos").select("*, shops(name)").order("created_at", { ascending: false }).limit(60);
  pane.innerHTML = `<section class="panel"><h2>新しい写真</h2><p class="muted small">問題のある写真は「非表示」にすると、公開ページから消えます（オーナーには「運営により非表示」と出ます）。</p>
    <div class="photos">${(data || []).map((p) => `<div class="photo" data-id="${p.id}"><img src="${esc(photoUrl(p.path))}" alt="" loading="lazy" />
      <div class="tools"><span class="small">${esc(p.shops?.name)}</span><span class="small muted">${fmtDate(p.created_at)}</span>
      <button class="icon-btn ${p.is_hidden ? "" : "danger"}" data-hide="${p.is_hidden ? 0 : 1}">${p.is_hidden ? "表示に戻す" : "非表示にする"}</button></div></div>`).join("") || '<p class="muted">写真はまだありません。</p>'}</div></section>`;
  pane.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-hide]"); if (!b) return;
    await sb.from("shop_photos").update({ is_hidden: b.dataset.hide === "1" }).eq("id", b.closest(".photo").dataset.id); show();
  });
}
