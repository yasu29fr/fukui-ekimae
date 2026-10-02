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
  const SHORT = { "寿司・海鮮": "寿司", "そば・うどん": "そば", "焼肉・肉料理": "焼肉", "焼鳥・串": "焼鳥", "イタリアン・フレンチ": "洋風",
    "アジア・各国料理": "各国", "カフェ・スイーツ": "カフェ", "スナック・ラウンジ": "スナック" };
  const svg = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
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
      .concat(genres.map((g) => `<button class="chip" data-genre="${esc(g)}" aria-pressed="${state.genre === g}">${ICONS[g] || ""} ${esc(g)}<small>${counts[g]}</small></button>`))
      .join("");
  }

  function stamp(s) {
    return `<span class="stamp" aria-hidden="true">${ICONS[s.genre] || "🍴"}<small>${esc(SHORT[s.genre] || s.genre)}</small></span>`;
  }
  function area(s) {
    return `<span class="t-area">${svg("pin")}${esc(ZONES[s.zone] || "")}${s.town ? "・" + esc(s.town) : ""}</span>`;
  }
  function stub(s, full) {
    return `<div class="perf"></div><div class="stub">
      ${s.instagram ? `<a class="pill ig" href="${igUrl(s.instagram)}" target="_blank" rel="noopener">${svg("ig")}@${esc(s.instagram)}</a>` : ""}
      ${full ? ((s.is_paid && s.links) || []).map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${svg("link")}${esc(l.label || LINK_LABEL[l.kind] || "リンク")}</a>`).join("") : ""}
      <a class="pill" href="${mapUrl(s)}" target="_blank" rel="noopener">${svg("map")}地図</a>
    </div>`;
  }

  function card(s) {
    const top = s.is_paid && s.photos && s.photos[0];
    return `<li class="ticket${s.is_paid ? " is-pr" : ""}">
      <a class="t-link" href="#/shop/${encodeURIComponent(s.slug)}">
        ${top ? `<div class="t-photo" style="background-image:url('${esc(photoUrl(top.path))}')" role="img" aria-label="${esc(top.caption || s.name)}"><span class="pr-tag">PR</span></div>` : ""}
        <div class="t-main">
          ${stamp(s)}
          <div class="t-text">
            <div class="t-tags"><span class="kind"><i></i>${esc(s.genre)}</span>${s.is_paid && !top ? '<span class="pr-tag">PR</span>' : ""}</div>
            <h3 class="t-title">${esc(s.name)}</h3>
            ${s.is_paid && s.catch ? `<p class="t-note">${esc(s.catch)}</p>` : ""}
            ${area(s)}
          </div>
        </div>
      </a>
      ${stub(s, false)}
    </li>`;
  }

  function renderList() {
    const night = state.mode === "night";
    document.body.dataset.mode = state.mode;
    document.querySelectorAll("[data-mode]").forEach((b) => b.tagName === "BUTTON" && b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    document.querySelectorAll("#zone-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zone === state.zone)));
    document.querySelector('meta[name="theme-color"]').content = night ? "#2f2b55" : "#c8553d";
    $("#ph-title").textContent = night ? "夜のお店" : "グルメ";
    $("#ph-icon").setAttribute("href", night ? "#i-glass" : "#i-bowl");
    $("#lead").textContent = night ? "片町と駅前の、バー・スナック・ラウンジ。" : "福井駅前と片町で、きょう行くお店を。";
    const zoneName = state.zone ? ZONES[state.zone] : "駅前・片町";
    $("#sec-title").textContent = `${zoneName}の${state.genre || (night ? "夜のお店" : "お店")}`;
    renderChips();
    const list = filtered();
    $("#count").textContent = list.length;
    $("#cards").innerHTML = list.length
      ? list.slice(0, state.shown).map(card).join("")
      : '<li class="empty">条件に合うお店が見つかりませんでした。</li>';
    $("#more").hidden = list.length <= state.shown;
    $("#more").textContent = `もっと見る（あと${Math.max(0, list.length - state.shown)}件）`;
  }

  function renderDetail(slug) {
    const s = state.shops.find((x) => x.slug === slug);
    const el = $("#detail");
    if (!s) { location.hash = "#/"; return; }
    document.body.dataset.mode = s.category === "night" ? "night" : "day";
    const photos = (s.is_paid && s.photos) || [];
    el.innerHTML = `
      <button class="back" type="button" data-back>${svg("back")}一覧にもどる</button>
      <article class="ticket d-ticket${s.is_paid ? " is-pr" : ""}">
        ${photos.length ? `<div class="gallery">${photos.map((p) => `<figure><img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption || s.name)}" loading="lazy" />${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
        <div class="t-main">
          ${stamp(s)}
          <div class="t-text">
            <div class="t-tags"><span class="kind"><i></i>${esc(s.genre)}</span>${s.is_paid ? '<span class="pr-tag">PR</span>' : ""}</div>
            <h1 class="t-title">${esc(s.name)}</h1>
            ${s.is_paid && s.catch ? `<p class="t-note">${esc(s.catch)}</p>` : ""}
            ${area(s)}
          </div>
        </div>
        ${s.is_paid && s.description ? `<div class="d-sec"><h2>お店から</h2><p>${esc(s.description)}</p></div>` : ""}
        ${s.is_paid && (s.hours || s.holiday) ? `<div class="d-sec"><h2>${svg("clock")}営業時間・定休日</h2><p>${esc(s.hours)}${s.holiday ? `\n定休日：${esc(s.holiday)}` : ""}</p></div>` : ""}
        ${stub(s, true)}
      </article>
      ${s.is_paid ? "" : `<p class="free-note">営業時間などの最新情報は、お店の公式アカウントでご確認ください。<br>このお店の方ですか？ <a href="#inquiry">情報の修正・写真の掲載について</a></p>`}`;
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
    if (t.dataset.mode) {
      state.mode = t.dataset.mode; state.genre = ""; state.shown = PAGE; remember();
      if (location.hash.startsWith("#/shop/")) location.hash = "#/"; else renderList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (t.dataset.act === "search") { if (location.hash.startsWith("#/shop/")) location.hash = "#/"; setTimeout(() => $("#q-m").focus(), 50); }
    else if ("zone" in t.dataset && t.closest("#zone-seg")) { state.zone = t.dataset.zone; state.shown = PAGE; remember(); renderList(); }
    else if ("genre" in t.dataset) { state.genre = t.dataset.genre; state.shown = PAGE; renderList(); }
    else if (t.id === "more") { state.shown += PAGE; renderList(); }
    else if ("back" in t.dataset) { history.length > 1 ? history.back() : (location.hash = "#/"); }
  });
  for (const id of ["#q", "#q-m"]) {
    $(id).addEventListener("input", (e) => {
      state.q = e.target.value; state.shown = PAGE;
      for (const other of ["#q", "#q-m"]) if (other !== id) $(other).value = state.q;
      if (location.hash.startsWith("#/shop/")) location.hash = "#/"; else renderList();
    });
  }
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
    .catch((err) => { $("#lead").textContent = err.message; });
})();
