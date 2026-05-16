-- ============================================================
-- Marshall Flash Merch — Soporte para Modo Venta Anónimo
-- + Fix perfiles faltantes + imágenes de productos
-- Ejecutar DESPUÉS de schema.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PASO 1 (manual en Supabase Dashboard):
--   Authentication → Settings → "Enable anonymous sign-ins" → ON
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 2. Actualizar trigger para manejar usuarios anónimos (email NULL)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, active)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      CASE
        WHEN NEW.email IS NULL THEN 'Modo Venta'
        ELSE split_part(NEW.email, '@', 1)
      END
    ),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────
-- 3. Permitir que cada usuario cree/actualice su propio perfil
--    (cubre casos donde el trigger falla o el usuario existía antes)
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
CREATE POLICY "Users can create own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- ────────────────────────────────────────────────────────────
-- 4. Crear perfiles para usuarios que ya existían sin perfil
--    ⚠️ Sustituye 'tu@email.com' por tu email real antes de ejecutar
-- ────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, name, role, active)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(
    u.raw_user_meta_data->>'name',
    CASE WHEN u.email IS NOT NULL THEN split_part(u.email, '@', 1) ELSE 'Usuario' END
  ),
  'staff',
  true
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Asignar rol admin a tu usuario (reemplaza con tu email real)
-- UPDATE public.profiles SET role = 'admin' WHERE email = 'tu@email.com';

-- ────────────────────────────────────────────────────────────
-- 5. Política INSERT ventas — funciona para sesiones anónimas
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Autenticados pueden crear ventas" ON public.sales;
CREATE POLICY "Autenticados pueden crear ventas"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 6. Imágenes de productos del seed
-- ────────────────────────────────────────────────────────────
UPDATE public.products SET image_url = '/images/Disco.png' WHERE sku = 'CD-001';
UPDATE public.products SET image_url = '/images/Puas.png'  WHERE sku = 'PUAS-001';
-- Si tienes imagen de camiseta:
-- UPDATE public.products SET image_url = '/images/Camiseta.png' WHERE sku = 'CAMISETA-001';
