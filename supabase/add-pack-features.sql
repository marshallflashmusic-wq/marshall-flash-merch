-- ============================================================
-- Marshall Flash Merch - Pack Features v2
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Precio individual del producto dentro del pack
ALTER TABLE public.pack_items
  ADD COLUMN IF NOT EXISTS individual_pack_price DECIMAL(10,2);

-- 2. Función increment_stock (restaurar stock al eliminar ventas)
CREATE OR REPLACE FUNCTION public.increment_stock(
  p_product_id UUID,
  p_quantity INTEGER,
  p_sale_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  SELECT stock INTO v_current_stock
  FROM products WHERE id = p_product_id FOR UPDATE;

  UPDATE products
  SET stock = stock + p_quantity,
      updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, type, quantity, previous_stock, new_stock, reference_id, notes
  ) VALUES (
    p_product_id, 'return', p_quantity,
    v_current_stock, v_current_stock + p_quantity,
    p_sale_id, 'Restauración de stock'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Actualizar decrement_stock con soporte de tipo de movimiento (pack_sale)
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_product_id UUID,
  p_quantity INTEGER,
  p_sale_id UUID,
  p_user_id UUID,
  p_movement_type TEXT DEFAULT 'sale'
)
RETURNS VOID AS $$
DECLARE
  v_current_stock INTEGER;
  v_type TEXT;
  v_notes TEXT;
BEGIN
  SELECT stock INTO v_current_stock
  FROM products WHERE id = p_product_id FOR UPDATE;

  v_type := CASE
    WHEN p_movement_type = 'pack_sale' THEN 'pack_sale'
    ELSE 'sale'
  END;

  v_notes := CASE
    WHEN p_movement_type = 'pack_sale' THEN 'Venta (pack)'
    ELSE 'Venta'
  END;

  UPDATE products
  SET stock = GREATEST(0, stock - p_quantity),
      updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO inventory_movements (
    product_id, type, quantity, previous_stock, new_stock,
    reference_id, user_id, notes
  ) VALUES (
    p_product_id, v_type, p_quantity,
    v_current_stock, GREATEST(0, v_current_stock - p_quantity),
    p_sale_id, p_user_id, v_notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
