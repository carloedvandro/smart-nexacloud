-- Consultores voltam a enxergar apenas o que é deles
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
    )
  );

DROP POLICY IF EXISTS "leads_select" ON public.leads;
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated
  USING (public.can_view_lead(leads.id));

DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_conversation(conversation_id));

DROP POLICY IF EXISTS "lead_memory_select" ON public.lead_memory;
CREATE POLICY "lead_memory_select" ON public.lead_memory FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_lead(lead_id));

DROP POLICY IF EXISTS "conv_events_select" ON public.conversation_events;
CREATE POLICY "conv_events_select" ON public.conversation_events FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_conversation(conversation_id));

DROP POLICY IF EXISTS "ai_summaries_select" ON public.ai_summaries;
CREATE POLICY "ai_summaries_select" ON public.ai_summaries FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() AND public.can_view_conversation(conversation_id));