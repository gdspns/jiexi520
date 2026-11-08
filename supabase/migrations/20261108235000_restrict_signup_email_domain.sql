-- 注册邮箱域名白名单：仅允许腾讯（QQ / Foxmail）、网易 163 / 126、新浪邮箱注册，
-- 拦截临时邮箱、一次性邮箱与垃圾注册。
-- 通过 Supabase Auth "Before User Created" Hook 生效：
--   hook_before_user_created_uri = pg-functions://postgres/public/restrict_signup_email_domain
create or replace function public.restrict_signup_email_domain(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  email text := lower(coalesce(event->'user'->>'email', ''));
  domain text;
  allowed text[] := array[
    'qq.com', 'foxmail.com', 'vip.qq.com',          -- 腾讯邮箱
    '163.com', '126.com',                            -- 网易邮箱
    'sina.com', 'sina.cn', 'vip.sina.com'            -- 新浪邮箱
  ];
begin
  -- 没有邮箱（例如手机号注册）时交给后续规则处理
  if email = '' then
    return '{}'::jsonb;
  end if;

  domain := split_part(email, '@', 2);

  if not (domain = any(allowed)) then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 400,
        'message', '仅支持 QQ 邮箱、163 邮箱、新浪邮箱注册，请更换邮箱'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.restrict_signup_email_domain(jsonb) to supabase_auth_admin;

comment on function public.restrict_signup_email_domain(jsonb) is
  'Auth Before User Created Hook：限制注册邮箱只允许 QQ/Foxmail、163/126、新浪域名';
