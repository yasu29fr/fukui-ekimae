-- ふくふく｜福井エキマエ：データベースの初期設定
-- Supabase の SQL Editor に貼って実行するか、supabase db push で流す。

create extension if not exists pgcrypto;

-- ───────── 店 ─────────
create table public.shops (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,                 -- URL 用（例: tomoshibi）
  name         text not null,
  zone         text not null check (zone in ('ekimae','katamachi')),   -- 駅前 / 片町
  town         text not null default '',             -- 大手・順化・中央・つくも・照手・手寄・日之出
  category     text not null check (category in ('gourmet','night')),  -- 昼 / 夜
  genre        text not null default '',
  instagram    text not null default '',             -- ハンドル名のみ（@ なし）
  instagram_from text not null default 'research' check (instagram_from in ('research','owner','admin')),
  -- 有料プランで公開される項目
  catch        text not null default '',             -- ひとこと（40字）
  description  text not null default '',             -- 紹介文（400字）
  hours        text not null default '',
  holiday      text not null default '',
  -- 非公開（運営のみ）
  address      text not null default '',
  tel          text not null default '',
  sources      jsonb not null default '[]',          -- どのサイトで見つけたか
  admin_note   text not null default '',
  -- 掲載状態
  plan         text not null default 'free' check (plan in ('free','monthly','yearly')),
  plan_until   timestamptz,
  is_hidden    boolean not null default false,       -- 掲載拒否・閉店など
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.shops (zone, category);

-- リンク（有料：ホームページ・食べログなど最大10件）
create table public.shop_links (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops on delete cascade,
  kind       text not null default 'web' check (kind in
               ('web','tabelog','hotpepper','gmap','x','threads','tiktok','line','reserve','other')),
  label      text not null default '',
  url        text not null check (url ~ '^https://'),
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

-- 写真（有料：最大5枚。sort が最小のものがトップ画像）
create table public.shop_photos (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops on delete cascade,
  path       text not null,                          -- storage の photos バケット内のパス
  caption    text not null default '',
  sort       int  not null default 0,
  is_hidden  boolean not null default false,         -- 運営が非表示にしたもの
  created_at timestamptz not null default now()
);

-- 店とログインユーザーの紐付け（運営が招待して作る）
create table public.shop_members (
  shop_id     uuid not null references public.shops on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  email       text not null,
  invited_at  timestamptz not null default now(),
  primary key (shop_id, user_id)
);

-- 更新依頼（無料プランのオーナーが送る）
create table public.update_requests (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  status      text not null default 'open' check (status in ('open','done','rejected')),
  admin_note  text not null default '',
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

-- 掲載のお問い合わせ（ログイン不要。トップのフォームから）
create table public.inquiries (
  id          uuid primary key default gen_random_uuid(),
  shop_name   text not null check (char_length(shop_name) between 1 and 100),
  contact     text not null check (char_length(contact) between 3 and 200),
  message     text not null default '' check (char_length(message) <= 2000),
  status      text not null default 'open' check (status in ('open','done')),
  created_at  timestamptz not null default now()
);

-- Stripe の契約（Webhook が書き込む）
create table public.subscriptions (
  shop_id               uuid primary key references public.shops on delete cascade,
  stripe_customer_id    text not null,
  stripe_subscription_id text unique not null,
  status                text not null,               -- active / past_due / canceled …
  interval              text not null default '',    -- month / year
  current_period_end    timestamptz,
  updated_at            timestamptz not null default now()
);

-- 運営者
create table public.admins (
  email text primary key
);
insert into public.admins (email) values ('yasu29fr@gmail.com');

-- ───────── 判定用の関数 ─────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = (auth.jwt() ->> 'email'));
$$;

create or replace function public.is_member(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shop_members where shop_id = sid and user_id = auth.uid());
$$;

create or replace function public.is_paid(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from shops where id = sid and plan <> 'free'
                 and (plan_until is null or plan_until > now()) and not is_hidden);
$$;

-- ───────── 公開用ビュー（ログインなしで読めるのはここだけ） ─────────
-- 無料：店名・ジャンル・エリア・地図リンク用の町名・Instagram
-- 有料：上に加えて ひとこと・紹介文・営業時間・定休日・リンク・写真
create or replace view public.public_shops as
select s.id, s.slug, s.name, s.zone, s.town, s.category, s.genre, s.instagram,
       public.is_paid(s.id) as is_paid,
       case when public.is_paid(s.id) then s.catch       else '' end as catch,
       case when public.is_paid(s.id) then s.description else '' end as description,
       case when public.is_paid(s.id) then s.hours       else '' end as hours,
       case when public.is_paid(s.id) then s.holiday     else '' end as holiday,
       case when public.is_paid(s.id) then coalesce((
         select json_agg(json_build_object('kind',l.kind,'label',l.label,'url',l.url) order by l.sort)
         from shop_links l where l.shop_id = s.id), '[]') else '[]' end as links,
       case when public.is_paid(s.id) then coalesce((
         select json_agg(json_build_object('path',p.path,'caption',p.caption) order by p.sort)
         from shop_photos p where p.shop_id = s.id and not p.is_hidden), '[]') else '[]' end as photos,
       s.updated_at
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;

-- ───────── 行単位の権限（RLS） ─────────
alter table public.shops           enable row level security;
alter table public.shop_links      enable row level security;
alter table public.shop_photos     enable row level security;
alter table public.shop_members    enable row level security;
alter table public.update_requests enable row level security;
alter table public.inquiries       enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.admins          enable row level security;

-- 店：運営は全部。オーナーは自分の店を読める。編集できるのは有料のときだけ。
create policy shops_admin  on public.shops for all using (is_admin()) with check (is_admin());
create policy shops_member_read on public.shops for select using (is_member(id));
create policy shops_member_edit on public.shops for update using (is_member(id) and is_paid(id)) with check (is_member(id));

-- リンク・写真：オーナーは有料のときだけ追加・変更・削除できる
create policy links_admin  on public.shop_links for all using (is_admin()) with check (is_admin());
create policy links_member on public.shop_links for all using (is_member(shop_id)) with check (is_member(shop_id) and is_paid(shop_id));
create policy photos_admin  on public.shop_photos for all using (is_admin()) with check (is_admin());
create policy photos_member on public.shop_photos for all using (is_member(shop_id)) with check (is_member(shop_id) and is_paid(shop_id));

create policy members_admin on public.shop_members for all using (is_admin()) with check (is_admin());
create policy members_self  on public.shop_members for select using (user_id = auth.uid());

create policy req_admin  on public.update_requests for all using (is_admin()) with check (is_admin());
create policy req_read   on public.update_requests for select using (user_id = auth.uid());
create policy req_insert on public.update_requests for insert with check (user_id = auth.uid() and is_member(shop_id));

create policy inq_admin  on public.inquiries for all using (is_admin()) with check (is_admin());
create policy inq_insert on public.inquiries for insert to anon, authenticated with check (status = 'open');

create policy subs_admin  on public.subscriptions for select using (is_admin());
create policy subs_member on public.subscriptions for select using (is_member(shop_id));

create policy admins_admin on public.admins for select using (is_admin());

-- オーナーが変えてはいけない列を守る（店名・エリア・プランなどは運営だけ）
create or replace function public.guard_shop_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- SQL エディタや service_role（Webhook など）からの変更は対象外。ログインしたオーナーだけを縛る。
  if auth.role() = 'authenticated' and not is_admin() then
    new.slug := old.slug; new.name := old.name; new.zone := old.zone; new.town := old.town;
    new.category := old.category; new.address := old.address; new.tel := old.tel;
    new.sources := old.sources; new.admin_note := old.admin_note;
    new.plan := old.plan; new.plan_until := old.plan_until; new.is_hidden := old.is_hidden;
    if new.instagram is distinct from old.instagram then new.instagram_from := 'owner'; end if;
    new.catch := left(new.catch, 40); new.description := left(new.description, 400);
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger shops_guard before update on public.shops
  for each row execute function public.guard_shop_update();

-- 枚数の上限（写真5枚・リンク10件）
create or replace function public.limit_children() returns trigger
language plpgsql as $$
declare n int; lim int;
begin
  lim := case tg_table_name when 'shop_photos' then 5 else 10 end;
  execute format('select count(*) from public.%I where shop_id = $1', tg_table_name) into n using new.shop_id;
  if n >= lim then raise exception '上限（%件）に達しています', lim; end if;
  return new;
end $$;
create trigger photos_limit before insert on public.shop_photos for each row execute function public.limit_children();
create trigger links_limit  before insert on public.shop_links  for each row execute function public.limit_children();

-- ───────── 写真の保存先 ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/webp','image/jpeg'])
on conflict (id) do nothing;

-- パスは「店ID/ファイル名」。オーナーは有料のときだけ自分の店のフォルダに置ける。
create policy photos_obj_read on storage.objects for select using (bucket_id = 'photos');
create policy photos_obj_write on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (is_admin() or (
    is_member(((storage.foldername(name))[1])::uuid) and is_paid(((storage.foldername(name))[1])::uuid))));
create policy photos_obj_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and (is_admin() or is_member(((storage.foldername(name))[1])::uuid)));
