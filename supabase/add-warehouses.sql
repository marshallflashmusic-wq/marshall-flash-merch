-- ============================================================
-- Almacenes: ubicaciones físicas donde se reparte el stock real
-- (sin duplicarlo). La suma de warehouse_stock por producto NO
-- debe exceder products.stock; lo que sobra se considera "sin
-- ubicar" (visible en la UI).
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.warehouses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouses_sort ON public.warehouses(sort_order);

CREATE TABLE IF NOT EXISTS public.warehouse_stock (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UNIQUE tratando NULL como un valor (variant_id puede ser null)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_warehouse_stock_wh_prod_var_notnull
  ON public.warehouse_stock(warehouse_id, product_id, variant_id)
  WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_warehouse_stock_wh_prod_var_null
  ON public.warehouse_stock(warehouse_id, product_id)
  WHERE variant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_stock_warehouse ON public.warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock_product   ON public.warehouse_stock(product_id);

ALTER TABLE public.warehouses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados ven warehouses" ON public.warehouses;
CREATE POLICY "Autenticados ven warehouses"
  ON public.warehouses FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins gestionan warehouses" ON public.warehouses;
CREATE POLICY "Admins gestionan warehouses"
  ON public.warehouses FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Autenticados ven warehouse_stock" ON public.warehouse_stock;
CREATE POLICY "Autenticados ven warehouse_stock"
  ON public.warehouse_stock FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins gestionan warehouse_stock" ON public.warehouse_stock;
CREATE POLICY "Admins gestionan warehouse_stock"
  ON public.warehouse_stock FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ────────────────────────────────────────────────────────────
-- Función unify_warehouse: borra cualquier asignación previa y
-- crea (o reusa) UN único almacén con todo el stock global
-- consolidado. Se usa al pulsar "Almacén único".
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unify_warehouse(p_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wh_id UUID;
  v_total_units INTEGER := 0;
  v_lines INTEGER := 0;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION 'NOMBRE_VACIO';
  END IF;

  -- Vaciar todo lo existente.
  -- WHERE TRUE es necesario en Supabase Cloud porque la extensión
  -- pg-safeupdate rechaza cualquier DELETE sin cláusula WHERE.
  DELETE FROM public.warehouse_stock WHERE TRUE;
  DELETE FROM public.warehouses      WHERE TRUE;

  -- Crear el único almacén
  INSERT INTO public.warehouses(name, sort_order)
  VALUES (trim(p_name), 0)
  RETURNING id INTO v_wh_id;

  -- Productos SIN variantes: una sola fila con products.stock
  FOR v_total_units, v_lines IN
    SELECT 0, 0  -- placeholder; usaremos otro bucle
  LOOP EXIT; END LOOP;

  INSERT INTO public.warehouse_stock(warehouse_id, product_id, variant_id, quantity)
  SELECT v_wh_id, p.id, NULL, p.stock
  FROM public.products p
  WHERE p.active = true
    AND NOT EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id);

  -- Productos CON variantes: una fila por variant con variant.stock
  INSERT INTO public.warehouse_stock(warehouse_id, product_id, variant_id, quantity)
  SELECT v_wh_id, v.product_id, v.id, v.stock
  FROM public.product_variants v
  JOIN public.products p ON p.id = v.product_id
  WHERE p.active = true;

  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
  INTO v_lines, v_total_units
  FROM public.warehouse_stock
  WHERE warehouse_id = v_wh_id;

  RETURN jsonb_build_object(
    'warehouse_id', v_wh_id,
    'lines', v_lines,
    'units', v_total_units
  );
END;
$$;
