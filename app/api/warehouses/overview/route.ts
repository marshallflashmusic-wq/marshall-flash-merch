import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Resumen global para la página /warehouses:
//   - lista de almacenes
//   - lista de productos activos con sus variantes
//   - todas las filas warehouse_stock
// El cliente pivota para presentar la matriz producto × almacén y calcular
// "sin ubicar" = product.stock - SUM(warehouse_stock.quantity).
export async function GET() {
  const supabase = getServiceClient()

  const [whRes, prodRes, varRes, stockRes] = await Promise.all([
    supabase.from('warehouses').select('*').order('sort_order').order('created_at'),
    supabase.from('products').select('id, name, image_url, stock, sort_order, active').eq('active', true),
    supabase.from('product_variants').select('id, product_id, size, stock'),
    supabase.from('warehouse_stock').select('warehouse_id, product_id, variant_id, quantity'),
  ])

  if (whRes.error)   return NextResponse.json({ error: whRes.error.message },   { status: 500 })
  if (prodRes.error) return NextResponse.json({ error: prodRes.error.message }, { status: 500 })
  if (varRes.error)  return NextResponse.json({ error: varRes.error.message },  { status: 500 })
  if (stockRes.error)return NextResponse.json({ error: stockRes.error.message },{ status: 500 })

  return NextResponse.json({
    warehouses: whRes.data ?? [],
    products:   prodRes.data ?? [],
    variants:   varRes.data ?? [],
    stock:      stockRes.data ?? [],
  })
}
