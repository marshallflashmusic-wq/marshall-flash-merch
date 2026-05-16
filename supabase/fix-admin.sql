-- ============================================================
-- FIX: Perfil admin + políticas para autogestión de perfiles
-- Ejecutar UNA VEZ en: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- 1. Permitir que un usuario autenticado inserte/actualice su propio perfil
DROP POLICY IF EXISTS "Users can create own profile" ON public.profiles;
CREATE POLICY "Users can create own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- 2. Crear o actualizar el perfil admin de marshallflashmusic@gmail.com
INSERT INTO public.profiles (id, email, name, role, active)
SELECT
  u.id,
  u.email,
  split_part(u.email, '@', 1),
  'admin',
  true
FROM auth.users u
WHERE u.email = 'marshallflashmusic@gmail.com'
ON CONFLICT (id) DO UPDATE
  SET role   = 'admin',
      active = true;
