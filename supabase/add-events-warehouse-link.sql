-- ============================================================
-- Vincular la reserva de stock al concierto con el almacén de origen.
-- Idempotente.
-- ============================================================

ALTER TABLE public.event_inventory
  ADD COLUMN IF NOT EXISTS warehouse_id UUID
    REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_inventory_warehouse
  ON public.event_inventory(warehouse_id);
