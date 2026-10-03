"""調査で作った店のリスト（CSV）から、Supabase に入れる初期データを作る。

    python scripts/build_seed.py 対象店舗.csv

出力
  supabase/seed/shops_public.sql   … 公開してよい項目だけ（店名・エリア・ジャンル・Instagram）
  private/shops_private.sql        … 住所・電話・出典（リポジトリには入れない。.gitignore 済み）
  docs/data/shops.json             … 公開項目だけ。Supabase をつなぐ前のサイト表示用

どちらも何度流しても同じ結果になる（slug で上書き）。
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 絞り込みに使うジャンル。上から順に当てはめ、最初に当たったものにする。
GENRES = [
    ("スナック・ラウンジ", r"スナック|ラウンジ|キャバ|クラブ|パブ|lounge|club|snack"),
    ("バー", r"バー|\bbar\b|パブ|ウイスキー|カクテル"),
    ("焼鳥・串", r"焼鳥|焼き鳥|やきとり|串"),
    ("寿司・海鮮", r"寿司|すし|鮨|海鮮|魚|かに|カニ|蟹"),
    ("そば・うどん", r"そば|蕎麦|うどん"),
    ("ラーメン", r"ラーメン|らーめん|麺"),
    ("焼肉・肉料理", r"焼肉|焼き肉|ホルモン|ステーキ|肉|ジンギスカン|シュラスコ|とんかつ|かつ"),
    ("居酒屋", r"居酒屋|酒場|飲み処|おでん|炉端|ろばた|バル"),
    ("イタリアン・フレンチ", r"イタリア|フレンチ|フランス|ビストロ|ピザ|パスタ|トラットリア"),
    ("中華", r"中華|餃子|点心"),
    ("アジア・各国料理", r"各国|アジア|エスニック|韓国|タイ|インド|カレー|ベトナム|メキシコ|スペイン"),
    ("カフェ・スイーツ", r"カフェ|喫茶|スイーツ|甘味|パン|ケーキ|和菓子|御菓子|フルーツ|パフェ|cafe|coffee"),
    ("洋食", r"洋食|レストラン|ハンバーグ|オムライス|ボルガ"),
    ("和食", r"和食|割烹|日本料理|料亭|郷土|定食|お食事処|天ぷら|うなぎ|鰻|丼"),
]
NIGHT_GENRES = {"スナック・ラウンジ", "バー"}
ZONE = {"駅前": "ekimae", "片町": "katamachi"}


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", html.unescape(s or "")).strip()


def clean_name(name: str) -> str:
    """掲載サイトが店名に付けた宣伝文句や記号を外す。"""
    n = norm(name)
    n = re.sub(r"^[!！\s]+", "", n)
    n = re.sub(r"^\d{4}/\d{1,2}/\d{1,2}\s*(?:グランド)?(?:オープン|OPEN|open)[★☆!！\s]*", "", n)
    n = re.sub(r"^(?:【[^】]{1,30}】\s*)+", "", n)
    n = re.sub(r"(?:\s*【[^】]{1,30}】)+$", "", n)
    return n.strip() or norm(name)


def genre_of(genre: str, name: str) -> str:
    # 「居酒屋/バー」「居酒屋・バー」はグルメサイトの大きな分類（居酒屋のこと）。バー扱いにしない
    text = re.sub(r"居酒屋\s*[/・]\s*バー", "居酒屋", norm(genre)) + " " + norm(name)
    for label, pat in GENRES:
        if re.search(pat, text, re.I):
            return label
    return "その他"


# ふりがな（検索用）。pykakasi で読みを作り、よくある読み違いを直す。
# 入っていなければ空のまま（運営画面で手で入れられる）。
try:
    import pykakasi
    _kks = pykakasi.kakasi()
except ImportError:  # pragma: no cover
    _kks = None
# 飲食店によく出る言葉は、先に読みを決めておく（pykakasi が読み違えやすいもの）
KANA_WORDS = {
    "寿司": "すし", "寿し": "すし", "鮨": "すし", "日之出": "ひので", "日の出": "ひので", "居酒屋": "いざかや",
    "酒場": "さかば", "割烹": "かっぽう", "料亭": "りょうてい", "中華": "ちゅうか", "料理": "りょうり",
    "食堂": "しょくどう", "茶屋": "ちゃや", "喫茶": "きっさ", "焼肉": "やきにく", "焼鳥": "やきとり",
    "串焼": "くしやき", "炭火": "すみび", "蕎麦": "そば", "饂飩": "うどん", "和食": "わしょく", "洋食": "ようしょく",
    "本店": "ほんてん", "支店": "してん", "駅前店": "えきまえてん", "駅前": "えきまえ", "西武": "せいぶ",
    "片町": "かたまち", "福井": "ふくい", "越前": "えちぜん", "庵": "あん", "亭": "てい", "店": "てん", "処": "どころ",
}
KANA_FIX = [("なごのしょく", "わのしょく")]


def kana_of(name: str) -> str:
    n = norm(name)
    paren = " ".join(re.findall(r"[（(]([^)）]*)[)）]", n))
    if not _kks:
        return ""
    base = re.sub(r"[（(][^)）]*[)）]", " ", n)
    for w in sorted(KANA_WORDS, key=len, reverse=True):
        base = base.replace(w, KANA_WORDS[w])
    k = "".join(x["hira"] for x in _kks.convert(base))
    for a, b in KANA_FIX:
        k = k.replace(a, b)
    # 括弧の中の読み（例：BAR SEA(バーシー)）も足す。カタカナはひらがなに
    k = (k + " " + "".join(x["hira"] for x in _kks.convert(paren))).strip()
    k = re.sub(r"[^\u3041-\u309f\u30fcA-Za-z0-9 ]", " ", k)
    return re.sub(r"\s+", " ", k).strip().lower()


def slug_of(name: str, address: str) -> str:
    return "s" + hashlib.sha1(f"{norm(name)}|{norm(address)}".encode()).hexdigest()[:8]


def handle_of(urls: str) -> str:
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", urls or "")
    return m.group(1).lower() if m else ""


def q(s: str) -> str:
    return "'" + (s or "").replace("'", "''") + "'"


def previous_slugs() -> tuple[dict, dict]:  # (電話番号→slug, 店名→[slug, …])
    """前回作った初期データから、電話番号→slug と 店名→slug の対応を読む。
    店名や住所が少し変わっても、同じ店の URL（slug）が変わらないようにするため。"""
    by_tel, by_name = {}, {}
    pp = ROOT / "private/shops_private.sql"
    if pp.exists():
        tels: dict[str, set] = {}
        for m in re.finditer(r"tel='([^']*)'.*?where slug='([^']+)'", pp.read_text(encoding="utf-8")):
            if m.group(1):
                tels.setdefault(m.group(1), set()).add(m.group(2))
        # 系列店などで電話番号を共有している店は、電話番号では決めない
        by_tel = {t: next(iter(v)) for t, v in tels.items() if len(v) == 1}
    pj = ROOT / "docs/data/shops.json"
    if pj.exists():
        for s in json.loads(pj.read_text(encoding="utf-8")):
            by_name.setdefault(norm(s["name"]), []).append(s["slug"])
    return by_tel, by_name


def main(path: str) -> None:
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    by_tel, by_name = previous_slugs()
    used: set[str] = set()
    pub, priv, js = [], [], []
    for r in rows:
        zone = ZONE.get(r["区分"])
        if not zone:
            continue
        r["店名"] = clean_name(r["店名"])
        g = genre_of(r["ジャンル"], r["店名"])
        # 夜のお店は、ジャンルがバー・スナック・ラウンジの店だけ。
        # （情報源の分類「居酒屋・バー」などに引きずられて、居酒屋や和食が夜に入らないように）
        category = "night" if g in NIGHT_GENRES else "gourmet"
        # 前回と同じ店（店名か電話番号が同じ）なら前回の slug を使う。初めての店だけ新しく作る
        fresh = slug_of(r["店名"], r["住所"])
        known = {x for v in by_name.values() for x in v}
        cands = ([fresh] if fresh in known else []) + by_name.get(norm(r["店名"]), []) + [by_tel.get(r["電話"])]
        slug = next((x for x in cands if x and x not in used), None) or fresh
        while slug in used:   # 念のため、重ならないようにする
            slug = slug_of(slug, r["電話"] + r["住所"])
        used.add(slug)
        kana = kana_of(r["店名"])
        opened = r.get("オープン日") or ""
        pub.append(f"({q(slug)},{q(norm(r['店名']))},{q(kana)},{q(opened) + '::date' if opened else 'null'},{q(zone)},{q(r['町'])},{q(category)},{q(g)},{q(handle_of(r['公式Instagram']))})")
        js.append(dict(slug=slug, name=norm(r["店名"]), kana=kana, opened_on=opened or None, zone=zone, town=r["町"], category=category,
                       genre=g, instagram=handle_of(r["公式Instagram"]), is_paid=False))
        sources = '["' + '","'.join(s.strip() for s in r["情報源"].split("/") if s.strip()) + '"]'
        # 営業時間・定休日は有料プランでだけ表に出る。調べた値を先に入れておき、お店が有料にしたとき直すだけで済むようにする。
        note = "出典: " + r["出典URL"] + (f"\nWebサイト: {r['Webサイト']}" if r.get("Webサイト") else "")
        priv.append(f"update public.shops set address={q(norm(r['住所']))}, tel={q(r['電話'])}, "
                    f"hours={q(norm(r.get('営業時間', '')))}, holiday={q(norm(r.get('定休日', '')))}, "
                    f"sources={q(sources)}::jsonb, admin_note={q(note)} where slug={q(slug)};")
    head = ("-- build_seed.py が作るファイル。手で直さないこと。\n"
            "insert into public.shops (slug,name,kana,opened_on,zone,town,category,genre,instagram) values\n")
    tail = ("\non conflict (slug) do update set name=excluded.name, zone=excluded.zone, town=excluded.town,\n"
            "  kana=case when public.shops.kana = '' then excluded.kana else public.shops.kana end,\n"
            "  opened_on=coalesce(public.shops.opened_on, excluded.opened_on),\n"
            "  category=excluded.category, genre=excluded.genre,\n"
            "  instagram=case when public.shops.instagram_from='research' then excluded.instagram else public.shops.instagram end;\n")
    (ROOT / "supabase/seed").mkdir(parents=True, exist_ok=True)
    (ROOT / "supabase/seed/shops_public.sql").write_text(head + ",\n".join(pub) + tail, encoding="utf-8")
    (ROOT / "private").mkdir(exist_ok=True)
    (ROOT / "private/shops_private.sql").write_text("\n".join(priv) + "\n", encoding="utf-8")
    (ROOT / "docs/data").mkdir(parents=True, exist_ok=True)
    (ROOT / "docs/data/shops.json").write_text(json.dumps(js, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(len(js), "店", dict(Counter(x["category"] for x in js)))


if __name__ == "__main__":
    main(sys.argv[1])
