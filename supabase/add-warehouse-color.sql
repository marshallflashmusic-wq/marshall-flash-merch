-- Color visual del almacén. Idempotente.
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#71717a';
