-- ============================================================
-- Sistema de Eventos v2: trazabilidad para restaurar ventas
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- Requiere: add-events-system.sql ya ejecutado
-- ============================================================

-- 1) Añadir columna event_inventory_id a inventory_movements
--    Cuando un movement viene de una venta en evento o de un ajuste de evento,
--    guardamos la fila concreta de event_inventory que cambió. Eso permite
--    revertir exactamente la misma fila al eliminar la venta.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS event_inventory_id UUID
    REFERENCES public.event_inventory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_event_inv
  ON public.inventory_movements(event_inventory_id);

-- 2) process_sale actualizado: guarda event_inventory_id en cada movement
CREATE OR REPLACE FUNCTION public.process_sale(
  p_sale_data        JSONB,
  p_items            JSONB,
  p_stock_decrements JSONB,
  p_idempotency_key  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id    UUID;
  v_user_id    UUID;
  v_curr_stock INTEGER;
  v_prev_stock INTEGER;
  v_rec        RECORD;
  v_einv_rec   RECORD;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_sale_id
    FROM public.sales
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', true);
    END IF;
  END IF;

  -- Validación stock global (decrements sin event_inventory_id)
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID       AS product_id,
      SUM((value->>'quantity')::INTEGER) AS total_qty
    FROM jsonb_array_elements(p_stock_decrements)
    WHERE NULLIF(value->>'event_inventory_id','') IS NULL
    GROUP BY value->>'product_id'
    ORDER BY value->>'product_id'
  LOOP
    SELECT stock INTO v_curr_stock
    FROM public.products WHERE id = v_rec.product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO:%', v_rec.product_id;
    END IF;
    IF v_curr_stock < v_rec.total_qty THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE:% disponible=% solicitado=%',
        v_rec.product_id, v_curr_stock, v_rec.total_qty;
    END IF;
  END LOOP;

  -- Validación stock event_inventory
  FOR v_einv_rec IN
    SELECT
      (value->>'event_inventory_id')::UUID AS einv_id,
      SUM((value->>'quantity')::INTEGER)   AS total_qty
    FROM jsonb_array_elements(p_stock_decrements)
    WHERE NULLIF(value->>'event_inventory_id','') IS NOT NULL
    GROUP BY value->>'event_inventory_id'
    ORDER BY value->>'event_inventory_id'
  LOOP
    DECLARE
      v_assigned INTEGER;
      v_sold INTEGER;
    BEGIN
      SELECT quantity_assigned, quantity_sold INTO v_assigned, v_sold
      FROM public.event_inventory WHERE id = v_einv_rec.einv_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'EVENT_INVENTORY_NO_ENCONTRADO:%', v_einv_rec.einv_id;
      END IF;
      IF (v_assigned - v_sold) < v_einv_rec.total_qty THEN
        RAISE EXCEPTION 'STOCK_EVENTO_INSUFICIENTE:% disponible=% solicitado=%',
          v_einv_rec.einv_id, (v_assigned - v_sold), v_einv_rec.total_qty;
      END IF;
    END;
  END LOOP;

  v_user_id := NULLIF(p_sale_data->>'user_id', '')::UUID;

  INSERT INTO public.sales (
    event_id, user_id, payment_method,
    total_amount, total_cost, profit,
    notes, seller_name, seller_type,
    synced, idempotency_key
  ) VALUES (
    NULLIF(p_sale_data->>'event_id', '')::UUID,
    v_user_id,
    p_sale_data->>'payment_method',
    (p_sale_data->>'total_amount')::DECIMAL,
    COALESCE(NULLIF(p_sale_data->>'total_cost',  '')::DECIMAL, 0),
    COALESCE(NULLIF(p_sale_data->>'profit',      '')::DECIMAL, 0),
    NULLIF(p_sale_data->>'notes', ''),
    NULLIF(p_sale_data->>'seller_name', ''),
    COALESCE(NULLIF(p_sale_data->>'seller_type', ''), 'admin'),
    COALESCE(NULLIF(p_sale_data->>'synced', '')::BOOLEAN, true),
    p_idempotency_key
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.sale_items (
    sale_id, product_id, pack_id,
    quantity, unit_price, unit_cost, subtotal, profit
  )
  SELECT
    v_sale_id,
    NULLIF(value->>'product_id', '')::UUID,
    NULLIF(value->>'pack_id',    '')::UUID,
    (value->>'quantity')::INTEGER,
    (value->>'unit_price')::DECIMAL,
    COALESCE(NULLIF(value->>'unit_cost', '')::DECIMAL, 0),
    (value->>'subtotal')::DECIMAL,
    COALESCE(NULLIF(value->>'profit',    '')::DECIMAL, 0)
  FROM jsonb_array_elements(p_items);

  -- Aplicar decrements
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID                          AS product_id,
      (value->>'quantity')::INTEGER                         AS quantity,
      COALESCE(NULLIF(value->>'movement_type', ''), 'sale') AS movement_type,
      NULLIF(value->>'event_inventory_id', '')::UUID        AS einv_id
    FROM jsonb_array_elements(p_stock_decrements)
    ORDER BY value->>'product_id'
  LOOP
    IF v_rec.einv_id IS NOT NULL THEN
      UPDATE public.event_inventory
        SET quantity_sold = quantity_sold + v_rec.quantity, updated_at = NOW()
        WHERE id = v_rec.einv_id;

      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_stock, new_stock,
        reference_id, user_id, notes, event_inventory_id
      ) VALUES (
        v_rec.product_id,
        v_rec.movement_type,
        v_rec.quantity,
        0, 0,
        v_sale_id,
        v_user_id,
        CASE WHEN v_rec.movement_type = 'pack_sale' THEN 'Venta evento (pack)' ELSE 'Venta evento' END,
        v_rec.einv_id
      );
    ELSE
      SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_rec.product_id;

      UPDATE public.products
        SET stock = stock - v_rec.quantity, updated_at = NOW()
        WHERE id = v_rec.product_id;

      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_stock, new_stock,
        reference_id, user_id, notes
      ) VALUES (
        v_rec.product_id,
        v_rec.movement_type,
        v_rec.quantity,
        v_prev_stock,
        v_prev_stock - v_rec.quantity,
        v_sale_id,
        v_user_id,
        CASE WHEN v_rec.movement_type = 'pack_sale' THEN 'Venta (pack)' ELSE 'Venta' END
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', false);

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- 3) Función restore_sale_stock: deshace los descuentos de stock de una venta
--    Usa inventory_movements como fuente de verdad: para cada movement con
--    reference_id = sale_id, revierte la operación contraria.
--    NO borra la venta (eso lo hace el endpoint después).
CREATE OR REPLACE FUNCTION public.restore_sale_stock(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mov RECORD;
  v_total_global INTEGER := 0;
  v_total_event INTEGER := 0;
BEGIN
  FOR v_mov IN
    SELECT id, product_id, quantity, type, event_inventory_id
    FROM public.inventory_movements
    WHERE reference_id = p_sale_id
      AND type IN ('sale', 'pack_sale')
    ORDER BY id
  LOOP
    IF v_mov.event_inventory_id IS NOT NULL THEN
      -- Venta de evento: decrementa quantity_sold (no toca stock global)
      UPDATE public.event_inventory
        SET quantity_sold = GREATEST(0, quantity_sold - v_mov.quantity),
            updated_at = NOW()
        WHERE id = v_mov.event_inventory_id;
      v_total_event := v_total_event + v_mov.quantity;

      -- Movement compensatorio para histórico
      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_stock, new_stock,
        reference_id, notes, event_inventory_id
      ) VALUES (
        v_mov.product_id, 'return', v_mov.quantity, 0, 0,
        p_sale_id, 'Restauración tras eliminar venta (evento)', v_mov.event_inventory_id
      );
    ELSE
      -- Venta rápida: sumar al stock global
      UPDATE public.products
        SET stock = stock + v_mov.quantity, updated_at = NOW()
        WHERE id = v_mov.product_id;
      v_total_global := v_total_global + v_mov.quantity;

      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_stock, new_stock,
        reference_id, notes
      )
      SELECT v_mov.product_id, 'return', v_mov.quantity,
             p.stock - v_mov.quantity, p.stock,
             p_sale_id, 'Restauración tras eliminar venta (rápida)'
      FROM public.products p WHERE p.id = v_mov.product_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'units_returned_global', v_total_global,
    'units_returned_event', v_total_event
  );
END;
$$;
