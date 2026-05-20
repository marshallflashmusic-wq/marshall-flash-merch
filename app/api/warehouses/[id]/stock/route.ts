import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/warehouses/[id]/stock
// Devuelve filas warehouse_stock con info enriquecida del producto/variante,
// y además — para cada producto — el total asignado en TODOS los almacenes y
// el stock global de products.stock, para que el cliente pueda mostrar lo
// "sin ubicar".
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  const { data, error } = await supabase
    .from('warehouse_stock')
    .select(`
      id, warehouse_id, product_id, variant_id, quantity, updated_at,
      product:products(id, name, image_url, sale_price, stock),
      variant:product_variants(id, size, stock)
    `)
    .eq('warehouse_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stock: data ?? [] })
}

// PATCH /api/warehouses/[id]/stock
// Body: { product_id, variant_id|null, quantity }
// Upsert sobre warehouse_stock. Valida que el total asignado por producto
// (sumando todos los almacenes) no exceda products.stock o, si hay variant,
// product_variants.stock.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: warehouseId } = await params
  const body = await request.json()
  const { product_id, variant_id, quantity } = body

  if (!product_id || typeof quantity !== 'number' || quantity < 0) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
  }

  // Cantidad global disponible para este producto/variant
  let available: number
  if (variant_id) {
    const { data: v } = await supabase
      .from('product_variants')
      .select('stock')
      .eq('id', variant_id)
      .single()
    if (!v) return NextResponse.json({ error: 'Variante no encontrada' }, { status: 404 })
    available = v.stock
  } else {
    const { data: p } = await supabase
      .from('products')
      .select('stock')
      .eq('id', product_id)
      .single()
    if (!p) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })
    available = p.stock
  }

  // Suma actual en los OTROS almacenes (mismo product_id + variant_id)
  let q = supabase
    .from('warehouse_stock')
    .select('quantity, warehouse_id, variant_id')
    .eq('product_id', product_id)
    .neq('warehouse_id', warehouseId)
  if (variant_id) q = q.eq('variant_id', variant_id)
  else q = q.is('variant_id', null)
  const { data: others, error: othersErr } = await q
  if (othersErr) return NextResponse.json({ error: othersErr.message }, { status: 500 })
  const sumOthers = (others ?? []).reduce((a, r) => a + (r.quantity ?? 0), 0)

  if (sumOthers + quantity > available) {
    return NextResponse.json(
      { error: `La suma supera el stock disponible (${available}). Hay ${sumOthers} en otros almacenes; máximo aquí ${Math.max(0, available - sumOthers)}.` },
      { status: 409 }
    )
  }

  // Upsert (busco existente; si existe actualizo, si no inserto)
  let existingQuery = supabase
    .from('warehouse_stock')
    .select('id')
    .eq('warehouse_id', warehouseId)
    .eq('product_id', product_id)
  if (variant_id) existingQuery = existingQuery.eq('variant_id', variant_id)
  else existingQuery = existingQuery.is('variant_id', null)
  const { data: existing } = await existingQuery.maybeSingle()

  if (existing) {
    if (quantity === 0) {
      const { error } = await supabase.from('warehouse_stock').delete().eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabase
        .from('warehouse_stock')
        .update({ quantity, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else if (quantity > 0) {
    const { error } = await supabase
      .from('warehouse_stock')
      .insert({
        warehouse_id: warehouseId,
        product_id,
        variant_id: variant_id ?? null,
        quantity,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
