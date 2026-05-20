-- ============================================================
-- Avisos bidireccionales TPV ↔ Admin (campana)
-- Añade soporte para mensajes admin → TPV (dirigidos a una sesión TPV).
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- 1) Crear tabla si no existe (por si no se ejecutó la v1)
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

-- 2) Columnas nuevas para bidireccionalidad
ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS from_role TEXT NOT NULL DEFAULT 'tpv';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'help_requests' AND column_name = 'from_role'
      AND constraint_name = 'help_requests_from_role_check'
  ) THEN
    ALTER TABLE public.help_requests
      ADD CONSTRAINT help_requests_from_role_check
      CHECK (from_role IN ('tpv', 'admin'));
  END IF;
END $$;

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS target_session_id UUID
    REFERENCES public.tpv_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS target_session_name TEXT;

CREATE INDEX IF NOT EXISTS idx_help_requests_status        ON public.help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_created       ON public.help_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_requests_from_role     ON public.help_requests(from_role);
CREATE INDEX IF NOT EXISTS idx_help_requests_target_session ON public.help_requests(target_session_id);

-- 3) RLS (no se requiere autenticación Supabase para el TPV; las APIs usan
--    service role, pero dejamos lectura abierta a autenticados por si acaso)
ALTER TABLE public.help_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados ven help_requests" ON public.help_requests;
CREATE POLICY "Autenticados ven help_requests"
  ON public.help_requests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anon ven help_requests" ON public.help_requests;
CREATE POLICY "Anon ven help_requests"
  ON public.help_requests FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "Autenticados crean help_requests" ON public.help_requests;
CREATE POLICY "Autenticados crean help_requests"
  ON public.help_requests FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Admins resuelven help_requests" ON public.help_requests;
CREATE POLICY "Admins resuelven help_requests"
  ON public.help_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- 4) Realtime opt-in (idempotente: si ya está, ignora el error)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.help_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
