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
    return n.strip() or norm(name)


def genre_of(genre: str, name: str) -> str:
    text = norm(genre) + " " + norm(name)
    for label, pat in GENRES:
        if re.search(pat, text, re.I):
            return label
    return "その他"


def slug_of(name: str, address: str) -> str:
    return "s" + hashlib.sha1(f"{norm(name)}|{norm(address)}".encode()).hexdigest()[:8]


def handle_of(urls: str) -> str:
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", urls or "")
    return m.group(1).lower() if m else ""


def q(s: str) -> str:
    return "'" + (s or "").replace("'", "''") + "'"


def main(path: str) -> None:
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    pub, priv, js = [], [], []
    for r in rows:
        zone = ZONE.get(r["区分"])
        if not zone:
            continue
        r["店名"] = clean_name(r["店名"])
        g = genre_of(r["ジャンル"], r["店名"])
        category = "night" if (r.get("夜") == "○" or g in NIGHT_GENRES) else "gourmet"
        slug = slug_of(r["店名"], r["住所"])
        pub.append(f"({q(slug)},{q(norm(r['店名']))},{q(zone)},{q(r['町'])},{q(category)},{q(g)},{q(handle_of(r['公式Instagram']))})")
        js.append(dict(slug=slug, name=norm(r["店名"]), zone=zone, town=r["町"], category=category,
                       genre=g, instagram=handle_of(r["公式Instagram"]), is_paid=False))
        sources = '["' + '","'.join(s.strip() for s in r["情報源"].split("/") if s.strip()) + '"]'
        priv.append(f"update public.shops set address={q(norm(r['住所']))}, tel={q(r['電話'])}, "
                    f"sources={q(sources)}::jsonb, admin_note={q('出典: ' + r['出典URL'])} where slug={q(slug)};")
    head = ("-- build_seed.py が作るファイル。手で直さないこと。\n"
            "insert into public.shops (slug,name,zone,town,category,genre,instagram) values\n")
    tail = ("\non conflict (slug) do update set name=excluded.name, zone=excluded.zone, town=excluded.town,\n"
            "  category=excluded.category, genre=excluded.genre,\n"
            "  instagram=case when public.shops.instagram_from='research' then excluded.instagram else public.shops.instagram end;\n")
    (ROOT / "supabase/seed").mkdir(parents=True, exist_ok=True)
    (ROOT / "supabase/seed/shops_public.sql").write_text(head + ",\n".join(pub) + tail, encoding="utf-8")
    (ROOT / "private").mkdir(exist_ok=True)
    (ROOT / "private/shops_private.sql").write_text("\n".join(priv) + "\n", encoding="utf-8")
    (ROOT / "docs/data").mkdir(parents=True, exist_ok=True)
    (ROOT / "docs/data/shops.json").write_text(json.dumps(js, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from collections import Counter
    print(len(pub), "店", Counter(p.split(",")[4] for p in pub))


if __name__ == "__main__":
    main(sys.argv[1])
