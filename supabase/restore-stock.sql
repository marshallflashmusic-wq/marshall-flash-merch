-- Función para restaurar stock al cancelar/eliminar una venta.
-- Simétrica a decrement_stock: usa FOR UPDATE para atomicidad
-- y registra el movimiento en inventory_movements.
CREATE OR REPLACE FUNCTION public.increment_stock(
  p_product_id UUID,
  p_quantity   INTEGER,
  p_sale_id    UUID,
  p_user_id    UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  SELECT stock INTO v_current_stock
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  UPDATE products
  SET stock      = stock + p_quantity,
      updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO inventory_movements
    (product_id, type, quantity, previous_stock, new_stock, reference_id, user_id, notes)
  VALUES
    (p_product_id, 'return', p_quantity,
     v_current_stock, v_current_stock + p_quantity,
     p_sale_id, p_user_id,
     'Devolución por cancelación de venta');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
