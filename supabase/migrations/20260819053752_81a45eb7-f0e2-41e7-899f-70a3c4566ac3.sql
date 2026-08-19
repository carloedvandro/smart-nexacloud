CREATE TABLE public.message_provider_payloads (
  message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider_key jsonb NOT NULL,
  provider_message jsonb NOT NULL,
  is_animated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.message_provider_payloads TO service_role;

ALTER TABLE public.message_provider_payloads ENABLE ROW LEVEL SECURITY;