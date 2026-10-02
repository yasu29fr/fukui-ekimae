-- Supabase のセキュリティチェック（Advisors）の指摘への対応
-- トリガー用の関数は API（/rest/v1/rpc）から直接呼べないようにする。トリガーとしては今までどおり動く。
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
-- 関数の中で参照する表を固定する（search_path を書き換えられても別の表を見ないように）
alter function public.limit_children() set search_path = public;

-- 次の指摘は意図どおりなので、そのままにする：
-- ・public_shops ビュー（SECURITY DEFINER）：公開してよい列だけを、ログインなしで読ませるための入口
-- ・is_admin / is_member / is_paid：RLS の判定に使う。ログインなしの人が呼ぶと false が返るだけ
