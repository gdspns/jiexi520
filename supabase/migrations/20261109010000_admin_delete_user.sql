-- 管理员删除用户：删除 auth.users 及 public 关联数据
-- 前端 deleteUser 服务函数通过 rpc("admin_delete_user") 调用。
-- 权限：user_roles.role='admin'，或邮箱 3075554556@qq.com，或 service_role（服务端密钥）。

create or replace function public.admin_delete_user(target_user_id uuid)
returns text
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_me uuid := auth.uid();
  v_is_admin boolean := false;
begin
  -- 服务端密钥（service_role）视为管理员
  if coalesce(auth.role(), '') = 'service_role' then
    v_is_admin := true;
  elsif v_me is not null then
    select exists (
             select 1 from public.user_roles r
              where r.user_id = v_me and r.role = 'admin'
           )
        or exists (
             select 1 from auth.users u
              where u.id = v_me and u.email = '3075554556@qq.com'
           )
    into v_is_admin;
  end if;

  if not v_is_admin then
    raise exception '无权限：仅管理员可删除用户';
  end if;

  if v_me is not null and v_me = target_user_id then
    raise exception '不能删除自己';
  end if;

  -- 目标不存在于 auth.users 时，仍清理可能残留的 profiles
  if not exists (select 1 from auth.users where id = target_user_id) then
    delete from public.profiles where id = target_user_id;
    return 'ok';
  end if;

  -- 先清业务数据，再删登录账号（auth.users 删除会级联 identities/sessions/refresh_tokens）
  delete from public.invites        where inviter_id = target_user_id or invitee_id = target_user_id;
  delete from public.payment_orders where user_id = target_user_id;
  delete from public.user_roles     where user_id = target_user_id;
  delete from public.profiles       where id = target_user_id;
  delete from auth.refresh_tokens rt using auth.sessions s
    where rt.session_id = s.id and s.user_id = target_user_id;
  delete from auth.sessions   where user_id = target_user_id;
  delete from auth.identities where user_id = target_user_id;
  delete from auth.users      where id = target_user_id;

  return 'ok';
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, service_role;
