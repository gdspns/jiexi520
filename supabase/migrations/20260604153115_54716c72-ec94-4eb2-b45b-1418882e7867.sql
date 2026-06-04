
-- 1) profiles: 列级权限，仅允许 authenticated 更新 email 列
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (email) ON public.profiles TO authenticated;

-- 2) admin_adjust_credits: 仅允许 service_role 调用
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) TO service_role;
