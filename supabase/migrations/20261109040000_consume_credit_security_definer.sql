-- 修复：有次数却提示「次数不足」
--
-- 背景：profiles 开启了 RLS，且为了防刷，已经收回了「用户可更新自己档案」的策略。
-- 而 consume_credit 是普通（invoker）函数，它内部那句
--   UPDATE public.profiles SET credits = credits - 1 ...
-- 在 RLS 下匹配到 0 行 → remaining 为 NULL → 抛「次数不足」，
-- 于是所有非管理员用户即便数据库里有几千次也解析不了。
--
-- 修法：把扣次函数改成 security definer（函数拥有者是 postgres，且会绕过 RLS），
-- 逻辑与签名保持不变，只额外收紧执行权限，避免被匿名调用。
create or replace function public.consume_credit()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  uid uuid := auth.uid();
  remaining integer;
  is_admin boolean;
begin
  if uid is null then
    raise exception '未登录';
  end if;

  select
    exists (select 1 from public.user_roles ur where ur.user_id = uid and ur.role::text = 'admin')
    or exists (select 1 from public.profiles pr where pr.id = uid and pr.email = '3075554556@qq.com')
  into is_admin;

  if is_admin then
    select credits into remaining from public.profiles where id = uid;
    return coalesce(remaining, 9999);
  end if;

  update public.profiles
     set credits = credits - 1
   where id = uid and credits > 0
   returning credits into remaining;

  if remaining is null then
    raise exception '次数不足';
  end if;
  return remaining;
end;
$function$;

revoke all on function public.consume_credit() from public;
revoke all on function public.consume_credit() from anon;
grant execute on function public.consume_credit() to authenticated;
grant execute on function public.consume_credit() to service_role;
