import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Vuelca al almacén [id] TODO el stock que aún no esté ubicado en ningún
// almacén (sin tocar las cantidades ya asignadas a otros almacenes ni
// duplicar stock). Para cada producto/variante:
//
//   sin_ubicar = stock_total - SUM(warehouse_stock.quantity en TODOS los almacenes)
//
// Si sin_ubicar > 0, se suma a la fila warehouse_stock de este almacén
// (upsert: actualiza si existe, inserta si no).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: warehouseId } = await params

  // Comprobar que el almacén existe
  const { data: wh, error: whErr } = await supabase
    .from('warehouses')
    .select('id')
    .eq('id', warehouseId)
    .single()
  if (whErr || !wh) {
    return NextResponse.json({ error: 'Almacén no encontrado' }, { status: 404 })
  }

  // Cargar productos activos, variantes y todo el stock asignado
  const [prodRes, varRes, stockRes] = await Promise.all([
    supabase.from('products').select('id, stock').eq('active', true),
    supabase.from('product_variants').select('id, product_id, stock'),
    supabase.from('warehouse_stock').select('warehouse_id, product_id, variant_id, quantity'),
  ])
  if (prodRes.error)  return NextResponse.json({ error: prodRes.error.message },  { status: 500 })
  if (varRes.error)   return NextResponse.json({ error: varRes.error.message },   { status: 500 })
  if (stockRes.error) return NextResponse.json({ error: stockRes.error.message }, { status: 500 })

  const stockAll = stockRes.data ?? []

  // Mapa: cuánto está asignado en total para cada (product_id, variant_id|null)
  const assignedTotal = new Map<string, number>()
  // Mapa: cantidad actual en ESTE almacén
  const hereCurrent = new Map<string, number>()
  for (const s of stockAll) {
    const key = `${s.product_id}::${s.variant_id ?? ''}`
    assignedTotal.set(key, (assignedTotal.get(key) ?? 0) + (s.quantity ?? 0))
    if (s.warehouse_id === warehouseId) {
      hereCurrent.set(key, (hereCurrent.get(key) ?? 0) + (s.quantity ?? 0))
    }
  }

  type Op = { product_id: string; variant_id: string | null; newQty: number }
  const ops: Op[] = []

  // Productos sin variantes
  const productsByVariant = new Map<string, { id: string; stock: number }[]>()
  for (const v of varRes.data ?? []) {
    const list = productsByVariant.get(v.product_id) ?? []
    list.push({ id: v.id, stock: v.stock })
    productsByVariant.set(v.product_id, list)
  }

  for (const p of prodRes.data ?? []) {
    const vs = productsByVariant.get(p.id) ?? []
    if (vs.length === 0) {
      const key = `${p.id}::`
      const unassigned = p.stock - (assignedTotal.get(key) ?? 0)
      if (unassigned > 0) {
        ops.push({ product_id: p.id, variant_id: null, newQty: (hereCurrent.get(key) ?? 0) + unassigned })
      }
    } else {
      for (const v of vs) {
        const key = `${p.id}::${v.id}`
        const unassigned = v.stock - (assignedTotal.get(key) ?? 0)
        if (unassigned > 0) {
          ops.push({ product_id: p.id, variant_id: v.id, newQty: (hereCurrent.get(key) ?? 0) + unassigned })
        }
      }
    }
  }

  let touched = 0
  let added = 0
  for (const op of ops) {
    // Hay fila ya en este almacén?
    let existingQuery = supabase
      .from('warehouse_stock')
      .select('id, quantity')
      .eq('warehouse_id', warehouseId)
      .eq('product_id', op.product_id)
    if (op.variant_id) existingQuery = existingQuery.eq('variant_id', op.variant_id)
    else existingQuery = existingQuery.is('variant_id', null)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('warehouse_stock')
        .update({ quantity: op.newQty, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      added += op.newQty - (existing.quantity ?? 0)
    } else {
      const { error } = await supabase
        .from('warehouse_stock')
        .insert({
          warehouse_id: warehouseId,
          product_id: op.product_id,
          variant_id: op.variant_id,
          quantity: op.newQty,
        })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      added += op.newQty
    }
    touched++
  }

  return NextResponse.json({ result: { touched_lines: touched, units_added: added } })
}
