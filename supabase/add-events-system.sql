-- ============================================================
-- Sistema de Eventos con Stock Reservado v1
-- Ejecutar en: Supabase Dashboard > SQL Editor
--
-- IMPORTANTE: Ejecutar DESPUÉS de:
--   - schema.sql
--   - robustness-v1.sql
--   - add-pack-features.sql
--   - sizes-v1.sql
-- ============================================================

-- ============================================================
-- 1) Ampliar tabla events: status + closed_at
-- ============================================================
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'closed', 'cancelled'));

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);

-- ============================================================
-- 2) Tabla event_inventory: stock físico reservado para un evento
--    variant_id NULL => producto sin tallas / asignación global del producto
--    variant_id NOT NULL => asignación por talla (Textil)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_inventory (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  quantity_assigned INTEGER NOT NULL DEFAULT 0 CHECK (quantity_assigned >= 0),
  quantity_sold INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_sold_not_exceed_assigned CHECK (quantity_sold <= quantity_assigned)
);

-- UNIQUE para (event_id, product_id, variant_id) tratando NULL como un valor real
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_inventory_evt_prod_var_notnull
  ON public.event_inventory(event_id, product_id, variant_id)
  WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_inventory_evt_prod_var_null
  ON public.event_inventory(event_id, product_id)
  WHERE variant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_inventory_event ON public.event_inventory(event_id);
CREATE INDEX IF NOT EXISTS idx_event_inventory_product ON public.event_inventory(product_id);

ALTER TABLE public.event_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados ven event_inventory" ON public.event_inventory;
CREATE POLICY "Autenticados ven event_inventory"
  ON public.event_inventory FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Solo admins gestionan event_inventory" ON public.event_inventory;
CREATE POLICY "Solo admins gestionan event_inventory"
  ON public.event_inventory FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- 3) Función: assign_event_stock — asignar stock a un evento
--    Atómica: descuenta del stock global (products + variants) y suma a event_inventory
--    p_delta puede ser negativo => devuelve al stock global (sin pasar de 0 en assigned-sold)
-- ============================================================
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
  v_inv_id UUID;
  v_inv_assigned INTEGER;
  v_inv_sold INTEGER;
  v_new_assigned INTEGER;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'DELTA_CERO';
  END IF;

  -- Validar evento existe y no está cerrado/cancelado
  SELECT status INTO v_event_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO';
  END IF;
  IF v_event_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'EVENTO_CERRADO';
  END IF;

  -- Bloquear producto
  SELECT stock INTO v_curr_stock FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCTO_NO_ENCONTRADO';
  END IF;

  -- Bloquear variant si aplica
  IF p_variant_id IS NOT NULL THEN
    SELECT stock INTO v_curr_variant_stock
    FROM public.product_variants WHERE id = p_variant_id AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VARIANTE_NO_ENCONTRADA';
    END IF;
  END IF;

  -- Buscar o crear fila de event_inventory
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

  -- Validaciones
  IF v_new_assigned < 0 THEN
    RAISE EXCEPTION 'ASIGNACION_NEGATIVA';
  END IF;

  IF v_new_assigned < v_inv_sold THEN
    RAISE EXCEPTION 'NO_PUEDE_DESASIGNAR_VENDIDO:assigned=% sold=%', v_new_assigned, v_inv_sold;
  END IF;

  -- Si delta > 0: validar y descontar del stock global
  IF p_delta > 0 THEN
    IF v_curr_stock < p_delta THEN
      RAISE EXCEPTION 'STOCK_GLOBAL_INSUFICIENTE:disponible=% solicitado=%', v_curr_stock, p_delta;
    END IF;
    IF p_variant_id IS NOT NULL AND v_curr_variant_stock < p_delta THEN
      RAISE EXCEPTION 'STOCK_VARIANTE_INSUFICIENTE:disponible=% solicitado=%', v_curr_variant_stock, p_delta;
    END IF;

    UPDATE public.products
      SET stock = stock - p_delta, updated_at = NOW()
      WHERE id = p_product_id;

    IF p_variant_id IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock - p_delta, updated_at = NOW()
        WHERE id = p_variant_id;
    END IF;
  ELSE
    -- delta < 0: devolver al stock global
    UPDATE public.products
      SET stock = stock + (-p_delta), updated_at = NOW()
      WHERE id = p_product_id;

    IF p_variant_id IS NOT NULL THEN
      UPDATE public.product_variants
        SET stock = stock + (-p_delta), updated_at = NOW()
        WHERE id = p_variant_id;
    END IF;
  END IF;

  -- Upsert event_inventory
  IF v_inv_id IS NULL THEN
    INSERT INTO public.event_inventory (event_id, product_id, variant_id, quantity_assigned, quantity_sold)
    VALUES (p_event_id, p_product_id, p_variant_id, v_new_assigned, 0)
    RETURNING id INTO v_inv_id;
  ELSE
    UPDATE public.event_inventory
      SET quantity_assigned = v_new_assigned, updated_at = NOW()
      WHERE id = v_inv_id;
  END IF;

  -- Registrar movimiento de inventario
  INSERT INTO public.inventory_movements (
    product_id, type, quantity, previous_stock, new_stock,
    reference_id, notes
  ) VALUES (
    p_product_id,
    CASE WHEN p_delta > 0 THEN 'adjustment' ELSE 'return' END,
    ABS(p_delta),
    v_curr_stock,
    v_curr_stock + (CASE WHEN p_delta > 0 THEN -p_delta ELSE -p_delta END),
    p_event_id,
    CASE WHEN p_delta > 0 THEN 'Asignación a evento' ELSE 'Devolución desde evento' END
  );

  RETURN jsonb_build_object(
    'inventory_id', v_inv_id,
    'quantity_assigned', v_new_assigned,
    'quantity_sold', v_inv_sold
  );
END;
$$;

-- ============================================================
-- 4) Función: close_event — cierra un evento y devuelve sobrantes
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_rec RECORD;
  v_total_returned INTEGER := 0;
  v_total_sold INTEGER := 0;
  v_lines INTEGER := 0;
BEGIN
  SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO';
  END IF;
  IF v_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'EVENTO_YA_CERRADO';
  END IF;

  -- Iterar event_inventory en orden estable para evitar deadlocks
  FOR v_rec IN
    SELECT id, product_id, variant_id, quantity_assigned, quantity_sold
    FROM public.event_inventory
    WHERE event_id = p_event_id
    ORDER BY product_id, variant_id NULLS FIRST
  LOOP
    v_lines := v_lines + 1;
    v_total_sold := v_total_sold + v_rec.quantity_sold;

    DECLARE
      v_leftover INTEGER := v_rec.quantity_assigned - v_rec.quantity_sold;
    BEGIN
      IF v_leftover > 0 THEN
        UPDATE public.products
          SET stock = stock + v_leftover, updated_at = NOW()
          WHERE id = v_rec.product_id;

        IF v_rec.variant_id IS NOT NULL THEN
          UPDATE public.product_variants
            SET stock = stock + v_leftover, updated_at = NOW()
            WHERE id = v_rec.variant_id;
        END IF;

        INSERT INTO public.inventory_movements (
          product_id, type, quantity, previous_stock, new_stock,
          reference_id, notes
        )
        SELECT
          v_rec.product_id,
          'return',
          v_leftover,
          p.stock - v_leftover,
          p.stock,
          p_event_id,
          'Devolución al cerrar evento'
        FROM public.products p WHERE p.id = v_rec.product_id;

        v_total_returned := v_total_returned + v_leftover;
      END IF;
    END;
  END LOOP;

  UPDATE public.events
    SET status = 'closed', closed_at = NOW(), active = false
    WHERE id = p_event_id;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'units_returned', v_total_returned,
    'units_sold', v_total_sold
  );
END;
$$;

-- ============================================================
-- 5) Función: cancel_event — cancela un evento (devuelve TODO, incluso lo vendido NO se toca)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_rec RECORD;
  v_total_returned INTEGER := 0;
BEGIN
  SELECT status INTO v_status FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENTO_NO_ENCONTRADO'; END IF;
  IF v_status = 'cancelled' THEN RAISE EXCEPTION 'EVENTO_YA_CANCELADO'; END IF;
  IF v_status = 'closed' THEN RAISE EXCEPTION 'EVENTO_YA_CERRADO'; END IF;

  -- Si nunca tuvo ventas, devolvemos TODO. Si hubo ventas, solo el remanente.
  FOR v_rec IN
    SELECT id, product_id, variant_id, quantity_assigned, quantity_sold
    FROM public.event_inventory
    WHERE event_id = p_event_id
    ORDER BY product_id, variant_id NULLS FIRST
  LOOP
    DECLARE
      v_leftover INTEGER := v_rec.quantity_assigned - v_rec.quantity_sold;
    BEGIN
      IF v_leftover > 0 THEN
        UPDATE public.products
          SET stock = stock + v_leftover, updated_at = NOW()
          WHERE id = v_rec.product_id;

        IF v_rec.variant_id IS NOT NULL THEN
          UPDATE public.product_variants
            SET stock = stock + v_leftover, updated_at = NOW()
            WHERE id = v_rec.variant_id;
        END IF;

        v_total_returned := v_total_returned + v_leftover;
      END IF;
    END;
  END LOOP;

  UPDATE public.events
    SET status = 'cancelled', closed_at = NOW(), active = false
    WHERE id = p_event_id;

  RETURN jsonb_build_object('units_returned', v_total_returned);
END;
$$;

-- ============================================================
-- 6) process_sale: actualizar para soportar modo evento
--
--    Estrategia: cada decrement puede incluir event_inventory_id (UUID).
--      - Si presente => descontamos event_inventory.quantity_sold (NO toca products.stock)
--        y, si la fila tiene variant_id, NO tocamos product_variants tampoco (ya descontado al asignar).
--      - Si ausente => modo rápido como hasta ahora: descontar products.stock.
--    También se admite p_event_inventory_decrements como lista paralela; si no se manda,
--    seguimos leyendo el campo event_inventory_id de cada item de p_stock_decrements.
-- ============================================================
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

  -- ─── Validación: stock GLOBAL para decrements sin event_inventory_id ───
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

  -- ─── Validación: stock por línea de EVENT_INVENTORY ───
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

  -- ─── Aplicar decrements ───
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
      -- Venta en EVENTO: solo actualiza event_inventory (el global ya está descontado desde la asignación)
      UPDATE public.event_inventory
        SET quantity_sold = quantity_sold + v_rec.quantity, updated_at = NOW()
        WHERE id = v_rec.einv_id;

      INSERT INTO public.inventory_movements (
        product_id, type, quantity, previous_stock, new_stock,
        reference_id, user_id, notes
      ) VALUES (
        v_rec.product_id,
        v_rec.movement_type,
        v_rec.quantity,
        0, 0, -- stock global no cambia con venta de evento
        v_sale_id,
        v_user_id,
        CASE WHEN v_rec.movement_type = 'pack_sale' THEN 'Venta evento (pack)' ELSE 'Venta evento' END
      );
    ELSE
      -- Venta RÁPIDA: descuenta global como siempre
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

-- ============================================================
-- 7) Vista útil: event_inventory con datos del producto/variante
-- ============================================================
CREATE OR REPLACE VIEW public.event_inventory_full AS
SELECT
  ei.id,
  ei.event_id,
  ei.product_id,
  ei.variant_id,
  ei.quantity_assigned,
  ei.quantity_sold,
  (ei.quantity_assigned - ei.quantity_sold) AS quantity_remaining,
  p.name AS product_name,
  p.image_url AS product_image,
  p.sale_price AS product_sale_price,
  p.purchase_price AS product_purchase_price,
  v.size AS variant_size,
  v.stock AS variant_global_stock,
  p.stock AS product_global_stock
FROM public.event_inventory ei
JOIN public.products p ON p.id = ei.product_id
LEFT JOIN public.product_variants v ON v.id = ei.variant_id;
