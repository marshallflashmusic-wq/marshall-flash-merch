-- ============================================================
-- Migración: talla en productos + bucket de imágenes
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1. Columna "size" (talla) en productos
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS size TEXT;

-- 2. Bucket público para imágenes de productos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Políticas del bucket
DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Admin upload product images" ON storage.objects;
CREATE POLICY "Admin upload product images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Admin update product images" ON storage.objects;
CREATE POLICY "Admin update product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Admin delete product images" ON storage.objects;
CREATE POLICY "Admin delete product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');
