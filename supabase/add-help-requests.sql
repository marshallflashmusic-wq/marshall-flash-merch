-- ============================================================
-- Avisos SOS del TPV al admin (campana de ayuda)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.help_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  seller_name TEXT NOT NULL,
  tpv_session_id UUID REFERENCES public.tpv_sessions(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_help_requests_status ON public.help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_created ON public.help_requests(created_at DESC);

ALTER TABLE public.help_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados ven help_requests" ON public.help_requests;
CREATE POLICY "Autenticados ven help_requests"
  ON public.help_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Autenticados crean help_requests" ON public.help_requests;
CREATE POLICY "Autenticados crean help_requests"
  ON public.help_requests FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admins resuelven help_requests" ON public.help_requests;
CREATE POLICY "Admins resuelven help_requests"
  ON public.help_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Realtime opt-in
ALTER PUBLICATION supabase_realtime ADD TABLE public.help_requests;
