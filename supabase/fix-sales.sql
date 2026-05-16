-- ============================================================
-- Fix ventas: permite user_id nulo (modo TPV sin sesión)
-- y políticas RLS simplificadas para que el admin gestione todo
-- ============================================================

-- 1. Hacer user_id nullable (modo TPV no tiene sesión autenticada)
ALTER TABLE public.sales ALTER COLUMN user_id DROP NOT NULL;

-- 2. Simplificar políticas de ventas para que el admin pueda leer/editar/borrar
DROP POLICY IF EXISTS "Autenticados pueden ver sus ventas" ON public.sales;
DROP POLICY IF EXISTS "Autenticados pueden crear ventas" ON public.sales;
DROP POLICY IF EXISTS "Solo admins pueden modificar ventas" ON public.sales;
DROP POLICY IF EXISTS "Autenticados pueden eliminar ventas" ON public.sales;

-- Permite a cualquier usuario autenticado ver todas las ventas
CREATE POLICY "Autenticados pueden ver ventas"
  ON public.sales FOR SELECT
  TO authenticated
  USING (true);

-- Permite a usuarios autenticados crear ventas
CREATE POLICY "Autenticados pueden crear ventas"
  ON public.sales FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Permite a usuarios autenticados editar ventas
CREATE POLICY "Autenticados pueden editar ventas"
  ON public.sales FOR UPDATE
  TO authenticated
  USING (true);

-- Permite a usuarios autenticados eliminar ventas
CREATE POLICY "Autenticados pueden eliminar ventas"
  ON public.sales FOR DELETE
  TO authenticated
  USING (true);
