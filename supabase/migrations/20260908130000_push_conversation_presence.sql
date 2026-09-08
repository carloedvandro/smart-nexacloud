CREATE TABLE public.push_conversation_views (
  subscription_id uuid NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  view_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subscription_id, view_id)
);

ALTER TABLE public.push_conversation_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_conversation_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_conversation_views TO service_role;

CREATE INDEX push_conversation_views_active_idx
  ON public.push_conversation_views(conversation_id, expires_at);

CREATE OR REPLACE FUNCTION public.set_push_conversation_view(
  _endpoint text, _view_id uuid, _conversation_id uuid, _sequence bigint
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _subscription public.push_subscriptions;
BEGIN
  IF auth.uid() IS NULL OR _view_id IS NULL OR _sequence IS NULL OR _sequence < 0 THEN
    RAISE EXCEPTION 'Solicitação de presença inválida';
  END IF;

  SELECT * INTO _subscription FROM public.push_subscriptions
   WHERE endpoint = _endpoint AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN false; END IF;

  IF _conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.conversations c
     WHERE c.id = _conversation_id AND c.company_id = _subscription.company_id
       AND (public.is_platform_admin() OR public.can_view_conversation(c.id))
  ) THEN
    RAISE EXCEPTION 'Conversa não disponível';
  END IF;

  INSERT INTO public.push_conversation_views AS v
    (subscription_id, view_id, user_id, conversation_id, sequence, expires_at)
  VALUES (_subscription.id, _view_id, auth.uid(), _conversation_id, _sequence,
          CASE WHEN _conversation_id IS NULL THEN now() ELSE now() + interval '20 seconds' END)
  ON CONFLICT (subscription_id, view_id) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         conversation_id = EXCLUDED.conversation_id,
         sequence = EXCLUDED.sequence,
         expires_at = EXCLUDED.expires_at
   WHERE v.sequence < EXCLUDED.sequence;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_push_conversation_view(text, uuid, uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_push_conversation_view(text, uuid, uuid, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.active_push_conversation_subscriptions(
  _conversation_id uuid, _subscription_ids uuid[]
)
RETURNS TABLE(subscription_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT v.subscription_id
    FROM public.push_conversation_views v
    JOIN public.push_subscriptions s ON s.id = v.subscription_id AND s.user_id = v.user_id
    JOIN public.conversations c ON c.id = v.conversation_id AND c.company_id = s.company_id
   WHERE v.conversation_id = _conversation_id
     AND v.subscription_id = ANY(_subscription_ids)
     AND v.expires_at > now();
$$;

REVOKE ALL ON FUNCTION public.active_push_conversation_subscriptions(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.active_push_conversation_subscriptions(uuid, uuid[]) TO service_role;
