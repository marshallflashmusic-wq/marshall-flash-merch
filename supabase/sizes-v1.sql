-- ============================================================
-- sizes-v1.sql  —  Stock por talla para productos textiles
-- Ejecutar en Supabase → SQL Editor
-- ============================================================

-- 1. Tabla de variantes (talla + stock)
CREATE TABLE IF NOT EXISTS product_variants (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size         text        NOT NULL,
  stock        integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, size)
);

-- 2. RLS
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- Service role (API server) puede hacer todo sin restricciones
DROP POLICY IF EXISTS "service_role_all" ON product_variants;
CREATE POLICY "service_role_all" ON product_variants
  TO service_role USING (true) WITH CHECK (true);

-- Usuarios autenticados (admin) leen y escriben
DROP POLICY IF EXISTS "authenticated_all" ON product_variants;
CREATE POLICY "authenticated_all" ON product_variants
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anónimos solo leen (TPV client-side)
DROP POLICY IF EXISTS "anon_read" ON product_variants;
CREATE POLICY "anon_read" ON product_variants
  FOR SELECT TO anon USING (true);

-- 3. Índice para joins rápidos
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);

-- ¡Listo! Ahora puedes asignar stock por talla a los productos Textil.
