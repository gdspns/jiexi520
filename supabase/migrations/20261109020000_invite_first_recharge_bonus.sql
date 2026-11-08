-- ============================================================
-- 拉新加码：被邀请的新人「首次充值」额外奖励邀请人 N 次
-- ============================================================

-- 1) 邀请记录上记录充值奖励（一次性）
alter table public.invites add column if not exists first_recharge_credits integer not null default 0;
alter table public.invites add column if not exists first_recharge_at timestamptz;

create index if not exists invites_recharge_idx on public.invites (first_recharge_at) where first_recharge_at is not null;

-- 2) 奖励参数（后台可改）
insert into public.app_settings (key, value)
values ('invite_reward_recharge', '50'::jsonb)
on conflict (key) do nothing;

-- 3) 首次充值结算：只在服务端（service_role）支付成功后调用
create or replace function public.invite_recharge_bonus(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter uuid;
  v_done timestamptz;
  v_reward int;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;

  select inviter_id, first_recharge_at
    into v_inviter, v_done
    from public.invites
   where invitee_id = p_user_id
   limit 1;

  -- 不是被邀请来的用户，直接跳过
  if v_inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'no_invite');
  end if;
  -- 已经领过首次充值奖励
  if v_done is not null then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  select (value)::text::int into v_reward
    from public.app_settings where key = 'invite_reward_recharge';
  if v_reward is null or v_reward <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  -- 原子占位：并发/重复回调时只有一次能成功
  update public.invites
     set first_recharge_credits = v_reward,
         first_recharge_at = now()
   where invitee_id = p_user_id
     and first_recharge_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  update public.profiles set credits = credits + v_reward where id = v_inviter;

  return jsonb_build_object('ok', true, 'credits', v_reward, 'inviter_id', v_inviter);
exception when others then
  -- 奖励失败绝不能影响支付到账
  return jsonb_build_object('ok', false, 'reason', 'error', 'message', sqlerrm);
end;
$$;

revoke all on function public.invite_recharge_bonus(uuid) from public;
grant execute on function public.invite_recharge_bonus(uuid) to service_role;

-- 4) 后台报表：带上充值奖励
create or replace function public.admin_invite_report()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception '无权限';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.invitee_count desc, t.last_invited_at desc), '[]'::jsonb)
    into v_rows
    from (
      select p.id as inviter_id,
             p.email as inviter_email,
             p.invite_code as invite_code,
             count(i.id)::int as invitee_count,
             coalesce(sum(i.inviter_credits), 0)::int as credits_granted,
             coalesce(sum(i.invitee_credits), 0)::int as credits_to_invitees,
             coalesce(sum(i.first_recharge_credits), 0)::int as recharge_credits,
             count(i.first_recharge_at)::int as recharge_count,
             max(i.created_at) as last_invited_at,
             jsonb_agg(
               jsonb_build_object(
                 'email', i.invitee_email,
                 'created_at', i.created_at,
                 'inviter_credits', i.inviter_credits,
                 'invitee_credits', i.invitee_credits,
                 'first_recharge_credits', i.first_recharge_credits,
                 'first_recharge_at', i.first_recharge_at
               ) order by i.created_at desc
             ) as invitees
        from public.invites i
        join public.profiles p on p.id = i.inviter_id
       group by p.id, p.email, p.invite_code
    ) t;

  return v_rows;
end;
$$;

revoke all on function public.admin_invite_report() from public;
grant execute on function public.admin_invite_report() to authenticated;

-- 5) 后台：调整奖励参数（新增「首次充值奖励」）
create or replace function public.admin_set_invite_rewards(
  p_inviter int,
  p_invitee int,
  p_daily_limit int,
  p_recharge int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception '无权限';
  end if;
  if p_inviter is null or p_inviter < 0 or p_inviter > 100000
     or p_invitee is null or p_invitee < 0 or p_invitee > 100000
     or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 10000
     or p_recharge is null or p_recharge < 0 or p_recharge > 100000 then
    raise exception '参数不合法';
  end if;

  insert into public.app_settings (key, value, updated_at) values
    ('invite_reward_inviter', to_jsonb(p_inviter), now()),
    ('invite_reward_invitee', to_jsonb(p_invitee), now()),
    ('invite_daily_limit', to_jsonb(p_daily_limit), now()),
    ('invite_reward_recharge', to_jsonb(p_recharge), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_invite_rewards(int, int, int, int) from public;
grant execute on function public.admin_set_invite_rewards(int, int, int, int) to authenticated;

-- 兼容旧调用（3 参数）：保留充值奖励原值
create or replace function public.admin_set_invite_rewards(
  p_inviter int,
  p_invitee int,
  p_daily_limit int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recharge int;
begin
  select (value)::text::int into v_recharge
    from public.app_settings where key = 'invite_reward_recharge';
  if v_recharge is null then v_recharge := 50; end if;
  return public.admin_set_invite_rewards(p_inviter, p_invitee, p_daily_limit, v_recharge);
end;
$$;

revoke all on function public.admin_set_invite_rewards(int, int, int) from public;
grant execute on function public.admin_set_invite_rewards(int, int, int) to authenticated;
