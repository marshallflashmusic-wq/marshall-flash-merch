-- ============================================================
-- Sistema de Conciertos v3: doble descuento al vender
--
-- Cambio de modelo:
--   - Asignar al concierto NO descuenta stock global (queda lógicamente
--     reservado). El admin asigna libremente sin tocar el inventario físico.
--   - Vender en concierto descuenta a la vez `event_inventory.quantity_sold`
--     y `products.stock` (+ `product_variants.stock` si aplica).
--   - Cerrar/cancelar concierto ya no devuelve "leftover" al global, porque
--     nunca se le quitó. El leftover sigue formando parte del stock global.
--   - Eliminar venta de concierto: restaura quantity_sold y suma al global.
--
-- Ejecutar después de add-events-system.sql y add-events-system-v2.sql.
-- Es idempotente: redefine las funciones con CREATE OR REPLACE.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) assign_event_stock — NO toca stock global
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_event_stock(
  p_event_id UUID,
  p_product_id UUID,
  p_variant_id UUID,
  p_delta INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_status TEXT;
  v_curr_stock INTEGER;
  v_curr_variant_stock INTEGER;
  v_committed_other INTEGER;
  v_inv_id UUID;
  v_inv_assigned INTEGER;
  v_inv_sold INTEGER;
  v_new_assigned INTEGER;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'DELTA_CERO';
  END IF;

  -- Validar concierto activo
  SELECT status INTO v_event_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO'; END IF;
  IF v_event_status IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'EVENTO_CERRADO'; END IF;

  -- Bloquear producto / variante
  SELECT stock INTO v_curr_stock FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO'; END IF;

  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_curr_variant_stock
    FROM public.product_variants WHERE id = p_variant_id AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'VARIANTE_NO_ENCONTRADA'; END IF;
  END IF;

  -- Buscar fila existente
  IF p_variant_id IS NULL THEN
    SELECT id, quantity_assigned, quantity_sold INTO v_inv_id, v_inv_assigned, v_inv_sold
    FROM public.event_inventory
    WHERE event_id = p_event_id AND product_id = p_product_id AND variant_id IS NULL
    FOR UPDATE;
  ELSE
    SELECT id, quantity_assigned, quantity_sold INTO v_inv_id, v_inv_assigned, v_inv_sold
    FROM public.event_inventory
    WHERE event_id = p_event_id AND product_id = p_product_id AND variant_id = p_variant_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    v_inv_assigned := 0;
    v_inv_sold := 0;
  END IF;

  v_new_assigned := v_inv_assigned + p_delta;

  IF v_new_assigned < 0 THEN RAISE EXCEPTION 'ASIGNACION_NEGATIVA'; END IF;
  IF v_new_assigned < v_inv_sold THEN
    RAISE EXCEPTION 'NO_PUEDE_DESASIGNAR_VENDIDO:assigned=% sold=%', v_new_assigned, v_inv_sold;
  END IF;

  -- Si subimos asignación: comprobar que el global tiene unidades suficientes
  -- considerando lo ya comprometido en OTROS conciertos abiertos.
  IF p_delta > 0 THEN
    SELECT COALESCE(SUM(ei.quantity_assigned - ei.quantity_sold), 0)
      INTO v_committed_other
    FROM public.event_inventory ei
    JOIN public.events e ON e.id = ei.event_id
    WHERE ei.product_id = p_product_id
      AND (p_variant_id IS NULL OR ei.variant_id = p_variant_id)
      AND (v_inv_id IS NULL OR ei.id <> v_inv_id)
      AND e.status IN ('upcoming', 'active');

    IF v_curr_stock - v_committed_other - v_inv_assigned < p_delta THEN
      RAISE EXCEPTION 'STOCK_GLOBAL_INSUFICIENTE:disponible=% solicitado=%',
        v_curr_stock - v_committed_other - v_inv_assigned, p_delta;
    END IF;

    IF p_variant_id IS NOT NULL AND v_curr_variant_stock - v_committed_other - v_inv_assigned < p_delta THEN
      RAISE EXCEPTION 'STOCK_VARIANTE_INSUFICIENTE:disponible=% solicitado=%',
        v_curr_variant_stock - v_committed_other - v_inv_assigned, p_delta;
    END IF;
  END IF;

  -- Upsert event_inventory (sin tocar products.stock)
  IF v_inv_id IS NULL THEN
    INSERT INTO public.event_inventory (event_id, product_id, variant_id, quantity_assigned, quantity_sold)
    VALUES (p_event_id, p_product_id, p_variant_id, v_new_assigned, 0)
    RETURNING id INTO v_inv_id;
  ELSE
    UPDATE public.event_inventory
      SET quantity_assigned = v_new_assigned, updated_at = NOW()
      WHERE id = v_inv_id;
  END IF;

  -- Movement informativo (no cambia stock, solo deja traza)
  INSERT INTO public.inventory_movements (
    product_id, type, quantity, previous_stock, new_stock,
    reference_id, notes
  ) VALUES (
    p_product_id,
    'adjustment',
    ABS(p_delta),
    v_curr_stock,
    v_curr_stock,
    p_event_id,
    CASE WHEN p_delta > 0 THEN 'Asignación a concierto (reserva lógica)' ELSE 'Devolución de asignación a concierto' END
  );

  RETURN jsonb_build_object(
    'inventory_id', v_inv_id,
    'quantity_assigned', v_new_assigned,
    'quantity_sold', v_inv_sold
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2) process_sale — venta en concierto descuenta también el global
-- ─────────────────────────────────────────────────────────────
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
  v_einv       RECORD;
BEGIN
  -- Idempotencia
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_sale_id
    FROM public.sales
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', true);
    END IF;
  END IF;

  -- Validación: stock global (TODAS las líneas, con y sin evento, ya que ahora
  -- también descontamos global en ventas de concierto)
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID       AS product_id,
      SUM((value->>'quantity')::INTEGER) AS total_qty
    FROM jsonb_array_elements(p_stock_decrements)
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

  -- Validación: stock por línea de event_inventory
  FOR v_einv_rec IN
    SELECT
      (value->>'event_inventory_id')::UUID AS einv_id,
      SUM((value->>'quantity')::INTEGER)   AS total_qty
    FROM jsonb_array_elements(p_stock_decrements)
    WHERE NULLIF(value->>'event_inventory_id','') IS NOT NULL
    GROUP BY value->>'event_inventory_id'
    ORDER BY value->>'event_inventory_id'
  LOOP
    SELECT quantity_assigned, quantity_sold INTO v_einv
    FROM public.event_inventory WHERE id = v_einv_rec.einv_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'EVENT_INVENTORY_NO_ENCONTRADO:%', v_einv_rec.einv_id;
    END IF;
    IF (v_einv.quantity_assigned - v_einv.quantity_sold) < v_einv_rec.total_qty THEN
      RAISE EXCEPTION 'STOCK_EVENTO_INSUFICIENTE:% disponible=% solicitado=%',
        v_einv_rec.einv_id, (v_einv.quantity_assigned - v_einv.quantity_sold), v_einv_rec.total_qty;
    END IF;
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

  -- Aplicar decrements: SIEMPRE descontamos global; si hay einv_id, además
  -- subimos quantity_sold del concierto.
  FOR v_rec IN
    SELECT
      (value->>'product_id')::UUID                          AS product_id,
      (value->>'quantity')::INTEGER                         AS quantity,
      COALESCE(NULLIF(value->>'movement_type', ''), 'sale') AS movement_type,
      NULLIF(value->>'variant_id', '')::UUID                AS variant_id,
      NULLIF(value->>'event_inventory_id', '')::UUID        AS einv_id
    FROM jsonb_array_elements(p_stock_decrements)
    ORDER BY value->>'product_id'
  LOOP
    SELECT stock INTO v_prev_stock FROM public.products WHERE id = v_rec.product_id;

    UPDATE public.products
      SET stock = stock - v_rec.quantity, updated_at = NOW()
      WHERE id = v_rec.product_id;

    IF v_rec.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock - v_rec.quantity, updated_at = NOW()
        WHERE id = v_rec.variant_id;
    END IF;

    IF v_rec.einv_id IS NOT NULL THEN
      UPDATE public.event_inventory
        SET quantity_sold = quantity_sold + v_rec.quantity, updated_at = NOW()
        WHERE id = v_rec.einv_id;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, type, quantity, previous_stock, new_stock,
      reference_id, user_id, notes, event_inventory_id
    ) VALUES (
      v_rec.product_id,
      v_rec.movement_type,
      v_rec.quantity,
      v_prev_stock,
      v_prev_stock - v_rec.quantity,
      v_sale_id,
      v_user_id,
      CASE
        WHEN v_rec.einv_id IS NOT NULL AND v_rec.movement_type = 'pack_sale' THEN 'Venta concierto (pack)'
        WHEN v_rec.einv_id IS NOT NULL THEN 'Venta concierto'
        WHEN v_rec.movement_type = 'pack_sale' THEN 'Venta (pack)'
        ELSE 'Venta'
      END,
      v_rec.einv_id
    );
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'duplicate', false);

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3) restore_sale_stock — al borrar una venta de concierto, devolvemos
--    el stock al global Y bajamos quantity_sold.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.restore_sale_stock(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mov RECORD;
  v_total_global INTEGER := 0;
  v_total_event INTEGER := 0;
  v_prev INTEGER;
BEGIN
  FOR v_mov IN
    SELECT id, product_id, quantity, type, event_inventory_id
    FROM public.inventory_movements
    WHERE reference_id = p_sale_id
      AND type IN ('sale', 'pack_sale')
    ORDER BY id
  LOOP
    -- Restaurar global SIEMPRE
    SELECT stock INTO v_prev FROM public.products WHERE id = v_mov.product_id;
    UPDATE public.products
      SET stock = stock + v_mov.quantity, updated_at = NOW()
      WHERE id = v_mov.product_id;
    v_total_global := v_total_global + v_mov.quantity;

    -- Si era venta de concierto, bajar quantity_sold también
    IF v_mov.event_inventory_id IS NOT NULL THEN
      UPDATE public.event_inventory
        SET quantity_sold = GREATEST(0, quantity_sold - v_mov.quantity),
            updated_at = NOW()
        WHERE id = v_mov.event_inventory_id;
      v_total_event := v_total_event + v_mov.quantity;
    END IF;

    INSERT INTO public.inventory_movements (
      product_id, type, quantity, previous_stock, new_stock,
      reference_id, notes, event_inventory_id
    ) VALUES (
      v_mov.product_id, 'return', v_mov.quantity,
      v_prev, v_prev + v_mov.quantity,
      p_sale_id,
      CASE WHEN v_mov.event_inventory_id IS NOT NULL
           THEN 'Restauración tras eliminar venta (concierto)'
           ELSE 'Restauración tras eliminar venta' END,
      v_mov.event_inventory_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'units_returned_global', v_total_global,
    'units_returned_event', v_total_event
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4) close_event — ya no devuelve leftover al global (nunca se quitó)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_rec RECORD;
  v_total_sold INTEGER := 0;
  v_total_leftover INTEGER := 0;
  v_lines INTEGER := 0;
BEGIN
  SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO'; END IF;
  IF v_status IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'EVENTO_YA_CERRADO'; END IF;

  FOR v_rec IN
    SELECT id, product_id, variant_id, quantity_assigned, quantity_sold
    FROM public.event_inventory
    WHERE event_id = p_event_id
    ORDER BY product_id, variant_id NULLS FIRST
  LOOP
    v_lines := v_lines + 1;
    v_total_sold := v_total_sold + v_rec.quantity_sold;
    v_total_leftover := v_total_leftover + (v_rec.quantity_assigned - v_rec.quantity_sold);

    INSERT INTO public.inventory_movements (
      product_id, type, quantity, previous_stock, new_stock,
      reference_id, notes
    )
    SELECT
      v_rec.product_id, 'adjustment',
      (v_rec.quantity_assigned - v_rec.quantity_sold),
      p.stock, p.stock,
      p_event_id,
      'Cierre concierto: libera reserva'
    FROM public.products p WHERE p.id = v_rec.product_id;
  END LOOP;

  UPDATE public.events
    SET status = 'closed', closed_at = NOW(), active = false
    WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'units_sold', v_total_sold,
    'units_released', v_total_leftover
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 5) cancel_event — solo cambia status; nada que devolver al global
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_released INTEGER;
BEGIN
  SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO'; END IF;
  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'EVENTO_YA_CANCELADO'; END IF;
  IF v_status = 'closed' THEN RAISE EXCEPTION 'EVENTO_YA_CERRADO'; END IF;

  SELECT COALESCE(SUM(quantity_assigned - quantity_sold), 0)
    INTO v_released
  FROM public.event_inventory
  WHERE event_id = p_event_id;

  UPDATE public.events
    SET status = 'cancelled', closed_at = NOW(), active = false
    WHERE id = p_event_id;

  RETURN jsonb_build_object('units_released', v_released);
END;
$$;
