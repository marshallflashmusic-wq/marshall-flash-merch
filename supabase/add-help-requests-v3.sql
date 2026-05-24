-- ============================================================
-- Mensajes cruzados entre admin / boss / tpv (campana).
-- Añade target_user_id para dirigir mensajes a un usuario concreto
-- (admin o boss) en lugar de — o además de — a una sesión TPV.
-- Idempotente.
-- ============================================================

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS target_user_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS target_user_name TEXT;

ALTER TABLE public.help_requests
  ADD COLUMN IF NOT EXISTS from_user_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_help_requests_target_user
  ON public.help_requests(target_user_id);
CREATE INDEX IF NOT EXISTS idx_help_requests_from_user
  ON public.help_requests(from_user_id);
