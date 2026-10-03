-- 有料プランのお店は、詳細ページに電話番号を出す（タップで電話できる）
-- ・公開ビューに tel を追加（無料のお店は空文字）
-- ・有料のオーナーは電話番号を編集できる（見せたくなければ空にできる）
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
       s.updated_at,
       case when public.is_paid(s.id) then s.tel else '' end as tel
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;

create or replace function public.guard_shop_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- SQL エディタや service_role（Webhook など）からの変更は対象外。ログインしたオーナーだけを縛る。
  if auth.role() = 'authenticated' and not is_admin() then
    new.slug := old.slug; new.name := old.name; new.zone := old.zone; new.town := old.town;
    new.category := old.category; new.address := old.address;
    new.sources := old.sources; new.admin_note := old.admin_note;
    new.plan := old.plan; new.plan_until := old.plan_until; new.is_hidden := old.is_hidden;
    if new.instagram is distinct from old.instagram then new.instagram_from := 'owner'; end if;
    new.catch := left(new.catch, 40); new.description := left(new.description, 400);
    new.tel := left(regexp_replace(new.tel, '[^0-9+-]', '', 'g'), 20);
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
