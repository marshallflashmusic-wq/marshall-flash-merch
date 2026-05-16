-- Añadir columna sort_order a products para orden personalizado
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Inicializar el orden con el orden alfabético actual
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) * 10 AS rn
  FROM public.products
)
UPDATE public.products
SET sort_order = ranked.rn
FROM ranked
WHERE public.products.id = ranked.id;
