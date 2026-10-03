-- 問い合わせのゴミ箱：削除すると deleted_at に日時が入り、一覧から外れる（元に戻せる）
alter table public.inquiries add column if not exists deleted_at timestamptz;
