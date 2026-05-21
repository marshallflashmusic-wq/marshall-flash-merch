-- Añadir rol 'boss' al sistema
-- Ejecutar en Supabase > SQL Editor

-- 1. Relajar check constraint de profiles.role si existe
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'staff', 'boss'));

-- 2. Promover marshallflashmusic@gmail.com a boss
UPDATE public.profiles
SET role = 'boss'
WHERE email = 'marshallflashmusic@gmail.com';

-- Verificar
SELECT id, email, name, role FROM public.profiles WHERE email = 'marshallflashmusic@gmail.com';
