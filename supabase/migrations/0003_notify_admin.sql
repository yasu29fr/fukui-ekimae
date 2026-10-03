-- お問い合わせ・更新依頼が届いたら、Edge Function notify-admin を呼んで運営にメールで知らせる
-- （ダッシュボードの Database Webhooks と同じことを SQL で行う）
-- 実行前に <プロジェクトID> と <NOTIFY_WEBHOOK_SECRET と同じ文字列> を置き換えること。
-- 合言葉は公開リポジトリに書かない。
create extension if not exists pg_net;

create or replace function public.notify_admin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform net.http_post(
    url := 'https://<プロジェクトID>.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', '<NOTIFY_WEBHOOK_SECRET と同じ文字列>'),
    body := jsonb_build_object('type', tg_op, 'table', tg_table_name, 'record', to_jsonb(new))
  );
  return new;
end $$;
revoke execute on function public.notify_admin() from public, anon, authenticated;

create trigger inquiries_notify after insert on public.inquiries
  for each row execute function public.notify_admin();
create trigger update_requests_notify after insert on public.update_requests
  for each row execute function public.notify_admin();
