-- ============================================================
-- Persistir el almacén de procedencia en cada sale_item.
-- Permite:
--   • Mostrar el almacén de origen en el resumen/detalle de venta.
--   • Al eliminar una venta, devolver cada artículo a su almacén origen
--     sin necesidad de consultar event_inventory (necesario también
--     para ventas rápidas que no tienen event_inventory).
-- Idempotente.
-- ============================================================

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID
    REFERENCES public.warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sale_items_warehouse
  ON public.sale_items(warehouse_id);
