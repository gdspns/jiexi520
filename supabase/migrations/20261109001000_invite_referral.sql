-- ============================================================
-- 拉新邀请：邀请码 / 邀请记录 / 奖励发放 / 管理员报表
-- ============================================================

-- 1) 每个用户一个唯一邀请码
alter table public.profiles add column if not exists invite_code text;

create or replace function public.new_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.profiles where invite_code = code);
  end loop;
  return code;
end;
$$;

-- 老用户回填
do $$
declare r record;
begin
  for r in select id from public.profiles where invite_code is null or invite_code = '' loop
    update public.profiles set invite_code = public.new_invite_code() where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column invite_code set default public.new_invite_code();
create unique index if not exists profiles_invite_code_key on public.profiles (invite_code);

-- 2) 邀请记录表
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null unique references public.profiles(id) on delete cascade,
  invitee_email text,
  inviter_credits integer not null default 0,
  invitee_credits integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invites_inviter_idx on public.invites (inviter_id, created_at desc);

alter table public.invites enable row level security;

drop policy if exists "inviters read own invites" on public.invites;
create policy "inviters read own invites" on public.invites
  for select to authenticated
  using (inviter_id = auth.uid());

drop policy if exists "admins read all invites" on public.invites;
create policy "admins read all invites" on public.invites
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3) 奖励参数（可在后台调整）
insert into public.app_settings (key, value)
values
  ('invite_reward_inviter', '3'::jsonb),
  ('invite_reward_invitee', '2'::jsonb),
  ('invite_daily_limit', '20'::jsonb)
on conflict (key) do nothing;

-- 4) 领取邀请奖励（新用户注册后调用）
create or replace function public.claim_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_inviter uuid;
  v_email text;
  v_reward_inviter int;
  v_reward_invitee int;
  v_daily_limit int;
  v_today int;
  v_give int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'no_auth', 'message', '请先登录');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty', 'message', '邀请码为空');
  end if;
  if exists (select 1 from public.invites where invitee_id = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already', 'message', '你已领取过邀请奖励');
  end if;

  select p.id into v_inviter
    from public.profiles p
   where upper(p.invite_code) = v_code
   limit 1;

  if v_inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'message', '邀请码无效');
  end if;
  if v_inviter = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'self', 'message', '不能使用自己的邀请码');
  end if;

  -- 记录的是「被邀请人」的邮箱，不是邀请人的
  select coalesce(email, '') into v_email from public.profiles where id = v_uid;

  select (value)::text::int into v_reward_inviter from public.app_settings where key = 'invite_reward_inviter';
  if v_reward_inviter is null then v_reward_inviter := 3; end if;
  select (value)::text::int into v_reward_invitee from public.app_settings where key = 'invite_reward_invitee';
  if v_reward_invitee is null then v_reward_invitee := 2; end if;
  select (value)::text::int into v_daily_limit from public.app_settings where key = 'invite_daily_limit';
  if v_daily_limit is null then v_daily_limit := 20; end if;

  -- 邀请人每天最多算计 N 条，超出仍绑定关系但不发次数，防止刷号
  select count(*) into v_today
    from public.invites
   where inviter_id = v_inviter
     and created_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');
  v_give := case when v_today >= v_daily_limit then 0 else v_reward_inviter end;

  begin
    insert into public.invites (code, inviter_id, invitee_id, invitee_email, inviter_credits, invitee_credits)
    values (v_code, v_inviter, v_uid, v_email, v_give, v_reward_invitee);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already', 'message', '你已领取过邀请奖励');
  end;

  if v_give > 0 then
    update public.profiles set credits = credits + v_give where id = v_inviter;
  end if;
  if v_reward_invitee > 0 then
    update public.profiles set credits = credits + v_reward_invitee where id = v_uid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'inviter_credits', v_give,
    'invitee_credits', v_reward_invitee,
    'capped', v_give = 0
  );
end;
$$;

revoke all on function public.claim_invite(text) from public;
grant execute on function public.claim_invite(text) to authenticated;

-- 5) 后台：邀请报表（按邀请人聚合）
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
             max(i.created_at) as last_invited_at,
             jsonb_agg(
               jsonb_build_object(
                 'email', i.invitee_email,
                 'created_at', i.created_at,
                 'inviter_credits', i.inviter_credits,
                 'invitee_credits', i.invitee_credits
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

-- 6) 后台：调整邀请奖励参数
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
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception '无权限';
  end if;
  if p_inviter is null or p_inviter < 0 or p_inviter > 100000
     or p_invitee is null or p_invitee < 0 or p_invitee > 100000
     or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 10000 then
    raise exception '参数不合法';
  end if;

  insert into public.app_settings (key, value, updated_at) values
    ('invite_reward_inviter', to_jsonb(p_inviter), now()),
    ('invite_reward_invitee', to_jsonb(p_invitee), now()),
    ('invite_daily_limit', to_jsonb(p_daily_limit), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_set_invite_rewards(int, int, int) from public;
grant execute on function public.admin_set_invite_rewards(int, int, int) to authenticated;

-- 7) 关闭「用户可改自己 profile」的写权限：原本可被用来给自己改 credits
drop policy if exists "Users can update own profile" on public.profiles;
