-- 1) Lead abandonado: visível para qualquer pessoa ativa da empresa
CREATE OR REPLACE FUNCTION public.is_abandoned_conversation(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conversation_id
      AND c.company_id = public.current_company_id()
      AND c.assigned_user_id IS NULL
      AND c.status IN ('WAITING_HUMAN','QUEUED')
      AND EXISTS (
        SELECT 1 FROM public.assignment_attempts a
        WHERE a.conversation_id = c.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.assignment_attempts a
        WHERE a.conversation_id = c.id AND a.status = 'WAITING'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_abandoned_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_abandoned_conversation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_view_conversation(_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conversation_id
      AND c.company_id = public.current_company_id()
      AND (
        public.is_company_admin()
        OR c.assigned_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.assignment_attempts a
          WHERE a.conversation_id = c.id
            AND a.consultant_id = auth.uid()
            AND a.status = 'WAITING'
        )
        OR public.is_abandoned_conversation(c.id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_lead(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = _lead_id
      AND l.company_id = public.current_company_id()
      AND (
        public.is_company_admin()
        OR l.assigned_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.conversations c
          WHERE c.lead_id = l.id
            AND (
              c.assigned_user_id = auth.uid()
              OR EXISTS (
                SELECT 1 FROM public.assignment_attempts a
                WHERE a.conversation_id = c.id
                  AND a.consultant_id = auth.uid()
                  AND a.status = 'WAITING'
              )
              OR public.is_abandoned_conversation(c.id)
            )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "conversations_select" ON public.conversations;
CREATE POLICY "conversations_select" ON public.conversations FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (
      public.is_company_admin()
      OR assigned_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.assignment_attempts a
        WHERE a.conversation_id = conversations.id
          AND a.consultant_id = auth.uid()
          AND a.status = 'WAITING'
      )
      OR public.is_abandoned_conversation(conversations.id)
    )
  );

-- 2) Avaliação de atendimento
CREATE TABLE IF NOT EXISTS public.service_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  rating smallint,
  comment text,
  reason text NOT NULL DEFAULT 'ABANDONED',
  asked_at timestamptz NOT NULL DEFAULT now(),
  rated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_ratings_conversation_unique UNIQUE (conversation_id),
  CONSTRAINT service_ratings_range CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5))
);

CREATE INDEX IF NOT EXISTS service_ratings_company_idx ON public.service_ratings (company_id, created_at DESC);

GRANT SELECT ON public.service_ratings TO authenticated;
GRANT ALL ON public.service_ratings TO service_role;

ALTER TABLE public.service_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_ratings_select" ON public.service_ratings;
CREATE POLICY "service_ratings_select" ON public.service_ratings FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_conversation(conversation_id));