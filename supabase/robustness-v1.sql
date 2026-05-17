-- ============================================================
-- Robustez v1 — Transacciones atómicas + Idempotencia
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Idempotency key en sales (previene ventas duplicadas)
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_idempotency_key
  ON public.sales(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2. process_sale: venta atómica, idempotente, valida stock con row lock
--    TODO ocurre en una sola transacción PostgreSQL.
--    Si algo falla → rollback automático completo.
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
BEGIN

  -- Idempotencia: si ya existe una venta con este key, la devolvemos sin crear otra
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_sale_id
    FROM public.sales
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', true);
    END IF;
  END IF;

  -- Validación y bloqueo de stock (row-level lock para concurrencia)
  -- Agregamos por producto para comparar el total necesario de una vez.
  -- ORDER BY product_id fijo → evita deadlocks entre transacciones concurrentes.
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID       AS product_id,
      SUM((value->>'quantity')::INTEGER) AS total_qty
    FROM jsonb_array_elements(p_stock_decrements)
    GROUP BY value->>'product_id'
    ORDER BY value->>'product_id'
  LOOP
    SELECT stock INTO v_curr_stock
    FROM public.products
    WHERE id = v_rec.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO:%', v_rec.product_id;
    END IF;

    IF v_curr_stock < v_rec.total_qty THEN
      RAISE EXCEPTION 'STOCK_INSUFICIENTE:% disponible=% solicitado=%',
        v_rec.product_id, v_curr_stock, v_rec.total_qty;
    END IF;
  END LOOP;

  -- Insertar venta
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

  -- Insertar sale_items
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

  -- Decrementar stock y registrar inventory_movements
  -- Las filas ya están bloqueadas; iteramos en el mismo orden para consistencia.
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID                          AS product_id,
      (value->>'quantity')::INTEGER                         AS quantity,
      COALESCE(NULLIF(value->>'movement_type', ''), 'sale') AS movement_type
    FROM jsonb_array_elements(p_stock_decrements)
    ORDER BY value->>'product_id'
  LOOP
    SELECT stock INTO v_prev_stock
    FROM public.products
    WHERE id = v_rec.product_id;

    UPDATE public.products
    SET stock      = stock - v_rec.quantity,
        updated_at = NOW()
    WHERE id = v_rec.product_id;

    INSERT INTO public.inventory_movements (
      product_id, type, quantity,
      previous_stock, new_stock,
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
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', false);

EXCEPTION
  WHEN OTHERS THEN
    RAISE; -- propaga → PostgreSQL revierte la transacción completa
END;
$$;

-- 3. Función de auditoría: detecta inconsistencias
CREATE OR REPLACE FUNCTION public.audit_stock_integrity()
RETURNS TABLE (
  issue        TEXT,
  product_id   UUID,
  product_name TEXT,
  detail       TEXT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  -- Stock negativo (no debería ocurrir con el CHECK constraint)
  SELECT
    'stock_negativo'::TEXT,
    p.id,
    p.name,
    'stock = ' || p.stock::TEXT
  FROM public.products p
  WHERE p.stock < 0

  UNION ALL

  -- Ventas recientes sin inventory_movements (últimos 30 días)
  SELECT
    'venta_sin_movimientos'::TEXT,
    NULL::UUID,
    NULL::TEXT,
    'sale_id = ' || s.id::TEXT
  FROM public.sales s
  WHERE s.created_at > NOW() - INTERVAL '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_movements im
      WHERE im.reference_id = s.id
    );
$$;

-- 4. Índice de rendimiento para audit y sync
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
  ON public.inventory_movements(reference_id);

CREATE INDEX IF NOT EXISTS idx_sales_created_at_desc
  ON public.sales(created_at DESC);
