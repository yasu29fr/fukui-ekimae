// ふくふく｜福井エキマエ — 公開サイト
// データは Supabase の public_shops ビュー（未設定なら data/shops.json）。ログインは不要。
(() => {
  const cfg = window.FUKUFUKU_CONFIG || {};
  const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const PAGE = 30;
  const ICONS = {
    "和食": "🍱", "寿司・海鮮": "🍣", "そば・うどん": "🥢", "ラーメン": "🍜", "焼肉・肉料理": "🥩",
    "焼鳥・串": "🍢", "居酒屋": "🏮", "イタリアン・フレンチ": "🍝", "中華": "🥟", "アジア・各国料理": "🍛",
    "カフェ・スイーツ": "☕", "洋食": "🍽", "バー": "🍸", "スナック・ラウンジ": "🎤", "その他": "🍴",
  };
  const ZONES = { ekimae: "駅前", katamachi: "片町" };
  const LINK_LABEL = {
    web: "ホームページ", tabelog: "食べログ", hotpepper: "ホットペッパー", gmap: "Googleマップ", x: "X",
    threads: "Threads", tiktok: "TikTok", line: "LINE", reserve: "予約", other: "リンク",
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = { mode: "day", zone: "", genre: "", q: "", shown: PAGE, shops: [] };

  try {
    const saved = JSON.parse(localStorage.getItem("fukufuku") || "{}");
    if (saved.mode === "night" || saved.mode === "day") state.mode = saved.mode;
    if (saved.zone in ZONES) state.zone = saved.zone;
  } catch (_) { /* 保存できない環境では毎回初期値 */ }
  const remember = () => { try { localStorage.setItem("fukufuku", JSON.stringify({ mode: state.mode, zone: state.zone })); } catch (_) {} };

  function photoUrl(path) {
    return `${cfg.supabaseUrl}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;
  }
  function mapUrl(s) {
    const q = `${s.name} 福井市${s.town || ""}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  function igUrl(h) { return `https://www.instagram.com/${encodeURIComponent(h)}/`; }

  async function load() {
    if (hasDb) {
      const url = `${cfg.supabaseUrl}/rest/v1/public_shops?select=*`;
      const res = await fetch(url, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` } });
      if (!res.ok) throw new Error(`データを読み込めませんでした（${res.status}）`);
      return res.json();
    }
    const res = await fetch("./data/shops.json");
    return res.json();
  }

  // 並び：有料（PR）→ Instagram あり → 名前順。有料同士は毎日入れ替わる（偏り防止）。
  function sortShops(list) {
    const day = new Date().toISOString().slice(0, 10);
    const h = (s) => [...(s.slug + day)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return list.sort((a, b) =>
      (b.is_paid - a.is_paid) || (a.is_paid && b.is_paid ? h(a) - h(b) : 0) ||
      (Boolean(b.instagram) - Boolean(a.instagram)) || a.name.localeCompare(b.name, "ja"));
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return state.shops.filter((s) =>
      (state.mode === "night" ? s.category === "night" : s.category === "gourmet") &&
      (!state.zone || s.zone === state.zone) &&
      (!state.genre || s.genre === state.genre) &&
      (!q || `${s.name} ${s.genre} ${s.town}`.toLowerCase().includes(q)));
  }

  function renderChips() {
    const pool = state.shops.filter((s) => (state.mode === "night" ? s.category === "night" : s.category === "gourmet"));
    const counts = {};
    pool.forEach((s) => { counts[s.genre] = (counts[s.genre] || 0) + 1; });
    const genres = Object.keys(counts).sort((a, b) => (a === "その他") - (b === "その他") || counts[b] - counts[a]);
    if (state.genre && !counts[state.genre]) state.genre = "";
    $("#genre-chips").innerHTML = [`<button class="chip" data-genre="" aria-pressed="${!state.genre}">すべて</button>`]
      .concat(genres.map((g) => `<button class="chip" data-genre="${esc(g)}" aria-pressed="${state.genre === g}">${ICONS[g] || ""} ${esc(g)}</button>`))
      .join("");
  }

  function card(s) {
    const top = s.is_paid && s.photos && s.photos[0];
    return `<li class="card">
      <a class="card-link" href="#/shop/${encodeURIComponent(s.slug)}">
        ${top ? `<div class="card-photo" style="background-image:url('${esc(photoUrl(top.path))}')" role="img" aria-label="${esc(top.caption || s.name)}"></div>` : ""}
        <div class="card-body">
          ${top ? "" : `<span class="genre-icon" aria-hidden="true">${ICONS[s.genre] || "🍴"}</span>`}
          <div class="card-main">
            <p class="card-name">${esc(s.name)}${s.is_paid ? '<span class="pr">PR</span>' : ""}</p>
            <p class="card-meta">${esc(ZONES[s.zone] || "")}${s.town ? `・${esc(s.town)}` : ""}　${esc(s.genre)}</p>
            ${s.is_paid && s.catch ? `<p class="card-catch">${esc(s.catch)}</p>` : ""}
          </div>
        </div>
      </a>
      <div class="card-actions">
        ${s.instagram ? `<a class="pill" href="${igUrl(s.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""}
        <a class="pill" href="${mapUrl(s)}" target="_blank" rel="noopener">地図</a>
      </div>
    </li>`;
  }

  function renderList() {
    document.body.dataset.mode = state.mode;
    document.querySelectorAll(".mode-switch button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === state.mode)));
    document.querySelectorAll("#zone-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zone === state.zone)));
    $("#hero-lead").textContent = state.mode === "night"
      ? "片町と駅前の、バー・スナック・ラウンジ。"
      : "福井駅前と片町で、きょう行くお店を。";
    renderChips();
    const list = filtered();
    $("#count").textContent = `${list.length}件`;
    $("#cards").innerHTML = list.length
      ? list.slice(0, state.shown).map(card).join("")
      : '<li class="empty">条件に合うお店が見つかりませんでした。</li>';
    $("#more").hidden = list.length <= state.shown;
  }

  function renderDetail(slug) {
    const s = state.shops.find((x) => x.slug === slug);
    const el = $("#detail");
    if (!s) { location.hash = "#/"; return; }
    document.body.dataset.mode = s.category === "night" ? "night" : "day";
    const photos = (s.is_paid && s.photos) || [];
    const links = (s.is_paid && s.links) || [];
    el.innerHTML = `
      <button class="back" type="button" data-back>← 一覧にもどる</button>
      <h1>${esc(s.name)}${s.is_paid ? '<span class="pr">PR</span>' : ""}</h1>
      <p class="meta">${esc(ZONES[s.zone] || "")}${s.town ? `・${esc(s.town)}` : ""}　${ICONS[s.genre] || ""} ${esc(s.genre)}</p>
      ${photos.length ? `<div class="gallery">${photos.map((p) => `<figure><img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption || s.name)}" loading="lazy" />${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
      ${s.is_paid && s.description ? `<div class="detail-section"><h2>お店から</h2><p>${esc(s.description)}</p></div>` : ""}
      ${s.is_paid && (s.hours || s.holiday) ? `<div class="detail-section"><h2>営業時間・定休日</h2><p>${esc(s.hours)}${s.holiday ? `\n定休日：${esc(s.holiday)}` : ""}</p></div>` : ""}
      <div class="detail-section"><h2>リンク</h2><div class="links">
        ${s.instagram ? `<a class="pill" href="${igUrl(s.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ""}
        ${links.map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || LINK_LABEL[l.kind] || "リンク")}</a>`).join("")}
        <a class="pill" href="${mapUrl(s)}" target="_blank" rel="noopener">地図で見る</a>
      </div></div>
      ${s.is_paid ? "" : `<p class="free-note">営業時間などの最新情報は、お店の公式アカウントでご確認ください。<br>このお店の方ですか？ <a href="#inquiry">情報の修正・掲載について</a></p>`}`;
    $("#app").hidden = true;
    el.hidden = false;
    document.title = `${s.name}｜ふくふく 福井エキマエ`;
    window.scrollTo(0, 0);
  }

  function route() {
    const m = location.hash.match(/^#\/shop\/(.+)$/);
    if (m) return renderDetail(decodeURIComponent(m[1]));
    $("#detail").hidden = true;
    $("#app").hidden = false;
    document.title = "ふくふく｜福井エキマエ — 福井駅前・片町のグルメと夜のお店";
    renderList();
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.mode && t.closest(".mode-switch")) { state.mode = t.dataset.mode; state.genre = ""; state.shown = PAGE; remember(); renderList(); }
    else if ("zone" in t.dataset && t.closest("#zone-seg")) { state.zone = t.dataset.zone; state.shown = PAGE; remember(); renderList(); }
    else if ("genre" in t.dataset) { state.genre = t.dataset.genre; state.shown = PAGE; renderList(); }
    else if (t.id === "more") { state.shown += PAGE; renderList(); }
    else if ("back" in t.dataset) { history.length > 1 ? history.back() : (location.hash = "#/"); }
  });
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = PAGE; renderList(); });
  window.addEventListener("hashchange", route);

  $("#inquiry-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#inquiry-msg"), btn = f.querySelector("button");
    if (!hasDb) { msg.textContent = "ただいま準備中です。Threads @fukui_ekimae の DM でご連絡ください。"; return; }
    btn.disabled = true; msg.textContent = "送信しています…";
    const body = { shop_name: f.shop_name.value.trim(), contact: f.contact.value.trim(), message: f.message.value.trim() };
    try {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/inquiries`, {
        method: "POST",
        headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      f.reset(); msg.textContent = "送信しました。運営から折り返しご連絡します。";
    } catch (err) {
      msg.textContent = "送信できませんでした。時間をおいてもう一度お試しください。";
    } finally { btn.disabled = false; }
  });

  load()
    .then((rows) => { state.shops = sortShops(rows); route(); })
    .catch((err) => { $("#count").textContent = err.message; });
})();
