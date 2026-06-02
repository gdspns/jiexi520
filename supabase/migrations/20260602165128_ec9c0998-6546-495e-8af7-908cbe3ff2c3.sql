
REVOKE EXECUTE ON FUNCTION public.consume_credit() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_credit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer) TO authenticated;
