-- ============================================================
-- Pedidos WEB: añade canal de venta y gastos de envío
-- Ejecutar en Supabase > SQL Editor (idempotente)
-- ============================================================
--
-- sale_channel: 'pos' (venta presencial — concierto o rápida)
--               'web' (pedido web, solo el rol 'boss' puede crearlas)
--
-- shipping_cost:        gastos de envío PAGADOS por el cliente (suma a total_amount).
-- shipping_actual_cost: gastos de envío REALES (lo que paga la empresa).
--                       La diferencia (shipping_cost - shipping_actual_cost)
--                       se refleja en profit a través de total_cost.
-- ============================================================

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_channel TEXT NOT NULL DEFAULT 'pos'
    CHECK (sale_channel IN ('pos', 'web'));

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0
    CHECK (shipping_cost >= 0);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS shipping_actual_cost DECIMAL(10,2) NOT NULL DEFAULT 0
    CHECK (shipping_actual_cost >= 0);

CREATE INDEX IF NOT EXISTS idx_sales_sale_channel ON public.sales(sale_channel);

-- ============================================================
-- Precio online por producto y por pack (opcional)
-- Si online_price IS NULL → usar sale_price normal en el pedido web.
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS online_price DECIMAL(10,2)
    CHECK (online_price IS NULL OR online_price >= 0);

ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS online_price DECIMAL(10,2)
    CHECK (online_price IS NULL OR online_price >= 0);

-- ============================================================
-- Actualizar process_sale para persistir sale_channel y shipping_cost
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
AS $func$
DECLARE
  v_sale_id    UUID;
  v_user_id    UUID;
  v_curr_stock INTEGER;
  v_prev_stock INTEGER;
  v_rec        RECORD;
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

  -- Validación y bloqueo de stock
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

  v_user_id := NULLIF(p_sale_data->>'user_id', '')::UUID;

  INSERT INTO public.sales (
    event_id, user_id, payment_method,
    total_amount, total_cost, profit,
    notes, seller_name, seller_type,
    synced, idempotency_key,
    sale_channel, shipping_cost, shipping_actual_cost
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
    p_idempotency_key,
    COALESCE(NULLIF(p_sale_data->>'sale_channel', ''), 'pos'),
    COALESCE(NULLIF(p_sale_data->>'shipping_cost', '')::DECIMAL, 0),
    COALESCE(NULLIF(p_sale_data->>'shipping_actual_cost', '')::DECIMAL, 0)
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
    RAISE;
END;
$func$;
