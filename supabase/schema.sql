-- ============================================================
-- Marshall Flash Merch - Supabase Schema
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Habilitar extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLA: profiles (usuarios de la app)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  avatar_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver perfiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins pueden gestionar perfiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Trigger para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- TABLA: categories
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6b7280',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Todos los autenticados pueden ver categorías"
  ON public.categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Solo admins pueden modificar categorías"
  ON public.categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: products
-- ============================================================
CREATE TABLE IF NOT EXISTS public.products (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  sku TEXT UNIQUE,
  purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  sale_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock INTEGER NOT NULL DEFAULT 2,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver productos"
  ON public.products FOR SELECT TO authenticated USING (true);

CREATE POLICY "Solo admins pueden modificar productos"
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Solo admins pueden actualizar productos"
  ON public.products FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Solo admins pueden eliminar productos"
  ON public.products FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: packs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.packs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sale_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  image_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver packs"
  ON public.packs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Solo admins pueden gestionar packs"
  ON public.packs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: pack_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pack_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES public.packs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  UNIQUE(pack_id, product_id)
);

ALTER TABLE public.pack_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver pack_items"
  ON public.pack_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Solo admins pueden gestionar pack_items"
  ON public.pack_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: events
-- ============================================================
CREATE TABLE IF NOT EXISTS public.events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  venue TEXT NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver eventos"
  ON public.events FOR SELECT TO authenticated USING (true);

CREATE POLICY "Solo admins pueden gestionar eventos"
  ON public.events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: sales
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'bizum', 'tarjeta', 'paypal', 'mixto')),
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  synced BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver ventas"
  ON public.sales FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados pueden crear ventas"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Solo admins pueden modificar ventas"
  ON public.sales FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- ============================================================
-- TABLA: sale_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sale_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  pack_id UUID REFERENCES public.packs(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT product_or_pack CHECK (product_id IS NOT NULL OR pack_id IS NOT NULL)
);

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver sale_items"
  ON public.sale_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados pueden crear sale_items"
  ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- TABLA: inventory_movements
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'adjustment', 'restock', 'pack_sale', 'return')),
  quantity INTEGER NOT NULL,
  previous_stock INTEGER NOT NULL,
  new_stock INTEGER NOT NULL,
  reference_id UUID,
  notes TEXT,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados pueden ver movimientos"
  ON public.inventory_movements FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados pueden crear movimientos"
  ON public.inventory_movements FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- FUNCIÓN: decrementar stock con registro de movimiento
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrement_stock(
  p_product_id UUID,
  p_quantity INTEGER,
  p_sale_id UUID,
  p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
  v_current_stock INTEGER;
BEGIN
  SELECT stock INTO v_current_stock FROM products WHERE id = p_product_id FOR UPDATE;

  UPDATE products
  SET stock = GREATEST(0, stock - p_quantity),
      updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO inventory_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, user_id, notes)
  VALUES (p_product_id, 'sale', p_quantity, v_current_stock, GREATEST(0, v_current_stock - p_quantity), p_sale_id, p_user_id, 'Venta');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- ÍNDICES para mejorar rendimiento
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_products_active ON public.products(active);
CREATE INDEX IF NOT EXISTS idx_products_stock ON public.products(stock);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON public.sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_event_id ON public.sales(event_id);
CREATE INDEX IF NOT EXISTS idx_sales_user_id ON public.sales(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON public.sale_items(sale_id);

-- ============================================================
-- DATOS SEED: Categorías
-- ============================================================
INSERT INTO public.categories (name, color) VALUES
  ('CD',         '#f59e0b'),
  ('Textil',     '#06b6d4'),
  ('Accesorios', '#8b5cf6')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DATOS SEED: Productos iniciales
-- (Ajustar precios según necesidades reales)
-- ============================================================
INSERT INTO public.products (name, description, category_id, sku, purchase_price, sale_price, stock, min_stock, active)
SELECT
  p.name, p.description,
  c.id AS category_id,
  p.sku, p.purchase_price, p.sale_price, p.stock, p.min_stock, true
FROM (VALUES
  ('CD Relativa Sencillez', 'Álbum debut de Marshall Flash', 'Música', 'CD-001', 3.50, 10.00, 50, 5),
  ('Chapa cuadrada', 'Chapa cuadrada con logo Marshall Flash', 'Accesorios', 'CHAP-SQ-001', 0.50, 2.00, 100, 10),
  ('Chapa redonda', 'Chapa redonda con logo Marshall Flash', 'Accesorios', 'CHAP-RD-001', 0.50, 2.00, 100, 10),
  ('Set púas', 'Set de 3 púas personalizadas Marshall Flash', 'Accesorios', 'PUAS-001', 1.00, 4.00, 60, 8)
) AS p(name, description, category_name, sku, purchase_price, sale_price, stock, min_stock)
JOIN public.categories c ON c.name = p.category_name
ON CONFLICT (sku) DO NOTHING;

-- ============================================================
-- DATOS SEED: Pack ejemplo
-- ============================================================
DO $$
DECLARE
  v_pack_id UUID;
  v_cd_id UUID;
  v_chapa_rd_id UUID;
  v_puas_id UUID;
BEGIN
  -- Crear pack
  INSERT INTO public.packs (name, description, sale_price, active)
  VALUES ('Pack Fan', 'CD + chapa redonda + set púas', 14.00, true)
  RETURNING id INTO v_pack_id;

  -- Obtener IDs de productos
  SELECT id INTO v_cd_id FROM products WHERE sku = 'CD-001';
  SELECT id INTO v_chapa_rd_id FROM products WHERE sku = 'CHAP-RD-001';
  SELECT id INTO v_puas_id FROM products WHERE sku = 'PUAS-001';

  -- Añadir items al pack
  IF v_pack_id IS NOT NULL AND v_cd_id IS NOT NULL THEN
    INSERT INTO public.pack_items (pack_id, product_id, quantity) VALUES
      (v_pack_id, v_cd_id, 1),
      (v_pack_id, v_chapa_rd_id, 1),
      (v_pack_id, v_puas_id, 1)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
