revoke all on function public.broadcast_claim_next(integer) from public, anon, authenticated;
revoke all on function public.broadcast_finalize(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.broadcast_enqueue_campaign(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_emergency_stop() from public, anon;
grant execute on function public.broadcast_claim_next(integer) to service_role;
grant execute on function public.broadcast_finalize(uuid, boolean, text, text) to service_role;
grant execute on function public.broadcast_enqueue_campaign(uuid) to service_role;
grant execute on function public.broadcast_emergency_stop() to authenticated, service_role;