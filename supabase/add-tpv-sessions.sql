-- ============================================================
-- TPV Sessions - Sesiones temporales por PIN
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Tabla de sesiones TPV
CREATE TABLE IF NOT EXISTS public.tpv_sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pin_code TEXT NOT NULL UNIQUE,
  seller_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.tpv_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tpv_sessions_deny_client"
  ON public.tpv_sessions FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Añadir info de vendedor a ventas
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS seller_name TEXT,
  ADD COLUMN IF NOT EXISTS seller_type TEXT DEFAULT 'admin'
    CHECK (seller_type IN ('admin', 'tpv'));
