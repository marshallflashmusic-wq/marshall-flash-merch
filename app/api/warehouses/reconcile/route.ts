import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Conciliar warehouse_stock con el stock real (products.stock / variant.stock).
// Si la suma asignada en almacenes supera el stock real para un producto/variante,
// se baja la diferencia del/los almacenes con más cantidad. El stock "que falta"
// quedará simplemente como "sin ubicar" (no creamos filas nuevas).
export async function POST() {
  const supabase = getServiceClient()

  const [prodRes, varRes, stockRes] = await Promise.all([
    supabase.from('products').select('id, stock, active'),
    supabase.from('product_variants').select('id, product_id, stock'),
    supabase.from('warehouse_stock').select('id, warehouse_id, product_id, variant_id, quantity'),
  ])
  if (prodRes.error)  return NextResponse.json({ error: prodRes.error.message },  { status: 500 })
  if (varRes.error)   return NextResponse.json({ error: varRes.error.message },   { status: 500 })
  if (stockRes.error) return NextResponse.json({ error: stockRes.error.message }, { status: 500 })

  const products = prodRes.data ?? []
  const variants = varRes.data  ?? []
  const stock    = stockRes.data ?? []

  // Mapa product_id → tiene variantes
  const hasVariants = new Map<string, boolean>()
  for (const v of variants) hasVariants.set(v.product_id, true)

  // stockByKey: lista de filas por (product_id, variant_id) ordenada por quantity DESC
  type Row = { id: string; warehouse_id: string; product_id: string; variant_id: string | null; quantity: number }
  const groups = new Map<string, Row[]>()
  for (const s of stock as Row[]) {
    const key = `${s.product_id}::${s.variant_id ?? ''}`
    const list = groups.get(key) ?? []
    list.push(s); groups.set(key, list)
  }

  // Stock real por clave
  const realByKey = new Map<string, number>()
  for (const p of products) {
    if (!hasVariants.get(p.id)) realByKey.set(`${p.id}::`, p.stock)
  }
  for (const v of variants) {
    realByKey.set(`${v.product_id}::${v.id}`, v.stock)
  }

  let unitsRemoved = 0
  let rowsTouched = 0
  let rowsDeleted = 0

  for (const [key, list] of groups.entries()) {
    list.sort((a, b) => b.quantity - a.quantity)
    const assigned = list.reduce((a, r) => a + (r.quantity ?? 0), 0)
    const real = realByKey.get(key) ?? 0
    let excess = assigned - real
    if (excess <= 0) continue

    // Bajar del almacén con más quantity hasta cubrir excess
    for (const r of list) {
      if (excess <= 0) break
      const take = Math.min(r.quantity, excess)
      const next = r.quantity - take
      if (next === 0) {
        const { error } = await supabase.from('warehouse_stock').delete().eq('id', r.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        rowsDeleted++
      } else {
        const { error } = await supabase
          .from('warehouse_stock')
          .update({ quantity: next, updated_at: new Date().toISOString() })
          .eq('id', r.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        rowsTouched++
      }
      excess -= take
      unitsRemoved += take
    }
  }

  return NextResponse.json({
    result: { units_removed: unitsRemoved, rows_updated: rowsTouched, rows_deleted: rowsDeleted },
  })
}
