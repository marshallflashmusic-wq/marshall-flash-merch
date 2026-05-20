import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type SB = ReturnType<typeof getServiceClient>

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  // Usamos la vista event_inventory_full + warehouse_id leído de la tabla base
  const [fullRes, baseRes] = await Promise.all([
    supabase.from('event_inventory_full').select('*').eq('event_id', id).order('product_name'),
    supabase.from('event_inventory').select('id, warehouse_id').eq('event_id', id),
  ])
  if (fullRes.error) return NextResponse.json({ error: fullRes.error.message }, { status: 500 })
  const whById = new Map<string, string | null>()
  for (const r of baseRes.data ?? []) whById.set(r.id, r.warehouse_id ?? null)
  const merged = (fullRes.data ?? []).map(row => ({ ...row, warehouse_id: whById.get(row.id) ?? null }))
  return NextResponse.json({ inventory: merged })
}

// Suma `delta` al warehouse_stock de (warehouseId, productId, variantId).
// Acepta delta negativo. Si la fila no existe y delta > 0, la crea.
async function addToWarehouseStock(
  supabase: SB,
  warehouseId: string,
  productId: string,
  variantId: string | null,
  delta: number,
): Promise<string | null> {
  if (delta === 0) return null
  let q = supabase
    .from('warehouse_stock')
    .select('id, quantity')
    .eq('warehouse_id', warehouseId)
    .eq('product_id', productId)
  if (variantId) q = q.eq('variant_id', variantId)
  else q = q.is('variant_id', null)
  const { data: existing } = await q.maybeSingle()

  if (existing) {
    const next = (existing.quantity ?? 0) + delta
    if (next < 0) return 'STOCK_ALMACEN_INSUFICIENTE'
    if (next === 0) {
      const { error } = await supabase.from('warehouse_stock').delete().eq('id', existing.id)
      if (error) return error.message
    } else {
      const { error } = await supabase
        .from('warehouse_stock')
        .update({ quantity: next, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) return error.message
    }
  } else {
    if (delta < 0) return 'STOCK_ALMACEN_INSUFICIENTE'
    const { error } = await supabase
      .from('warehouse_stock')
      .insert({ warehouse_id: warehouseId, product_id: productId, variant_id: variantId, quantity: delta })
    if (error) return error.message
  }
  return null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: eventId } = await params
  const body = await request.json()
  const { product_id, variant_id, delta, warehouse_id } = body

  if (!product_id || typeof delta !== 'number' || delta === 0) {
    return NextResponse.json({ error: 'Faltan parámetros (product_id, delta)' }, { status: 400 })
  }

  // Si NO se especifica almacén y delta < 0, leer el warehouse_id de la fila existente
  // (para devolver al almacén original).
  let effectiveWarehouseId: string | null = warehouse_id ?? null
  if (delta < 0 && !effectiveWarehouseId) {
    let q = supabase
      .from('event_inventory')
      .select('warehouse_id')
      .eq('event_id', eventId)
      .eq('product_id', product_id)
    if (variant_id) q = q.eq('variant_id', variant_id)
    else q = q.is('variant_id', null)
    const { data: row } = await q.maybeSingle()
    effectiveWarehouseId = row?.warehouse_id ?? null
  }

  // Pre-validación: si delta > 0 y se ha indicado almacén, comprobar que hay
  // suficiente en ese almacén ANTES de tocar event_inventory.
  if (delta > 0 && effectiveWarehouseId) {
    let q = supabase
      .from('warehouse_stock')
      .select('quantity')
      .eq('warehouse_id', effectiveWarehouseId)
      .eq('product_id', product_id)
    if (variant_id) q = q.eq('variant_id', variant_id)
    else q = q.is('variant_id', null)
    const { data: row } = await q.maybeSingle()
    const available = row?.quantity ?? 0
    if (available < delta) {
      return NextResponse.json(
        { error: `No hay stock suficiente en el almacén origen (disponible ${available}, solicitado ${delta}).` },
        { status: 409 }
      )
    }
  }

  // Llamar al RPC tradicional para validar y actualizar event_inventory
  const { data, error } = await supabase.rpc('assign_event_stock', {
    p_event_id: eventId,
    p_product_id: product_id,
    p_variant_id: variant_id ?? null,
    p_delta: delta,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('STOCK_GLOBAL_INSUFICIENTE')) {
      return NextResponse.json({ error: 'No hay suficiente stock global para asignar.' }, { status: 409 })
    }
    if (msg.includes('STOCK_VARIANTE_INSUFICIENTE')) {
      return NextResponse.json({ error: 'No hay suficiente stock de esta talla.' }, { status: 409 })
    }
    if (msg.includes('NO_PUEDE_DESASIGNAR_VENDIDO')) {
      return NextResponse.json({ error: 'No se puede desasignar: hay unidades ya vendidas en el evento.' }, { status: 409 })
    }
    if (msg.includes('EVENTO_CERRADO')) {
      return NextResponse.json({ error: 'El evento está cerrado o cancelado.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Actualizar warehouse_stock si se ha indicado almacén (o se ha podido inferir)
  if (effectiveWarehouseId) {
    // delta > 0 → quitar del almacén; delta < 0 → devolver al almacén
    const whErr = await addToWarehouseStock(
      supabase, effectiveWarehouseId, product_id, variant_id ?? null, -delta
    )
    if (whErr) {
      // Revertir el RPC para mantener consistencia
      await supabase.rpc('assign_event_stock', {
        p_event_id: eventId,
        p_product_id: product_id,
        p_variant_id: variant_id ?? null,
        p_delta: -delta,
      })
      const human = whErr === 'STOCK_ALMACEN_INSUFICIENTE'
        ? 'No hay stock suficiente en el almacén origen.'
        : whErr
      return NextResponse.json({ error: human }, { status: 409 })
    }

    // Guardar warehouse_id en la fila event_inventory (cuando asignamos +)
    if (delta > 0) {
      let q = supabase
        .from('event_inventory')
        .update({ warehouse_id: effectiveWarehouseId, updated_at: new Date().toISOString() })
        .eq('event_id', eventId)
        .eq('product_id', product_id)
      if (variant_id) q = q.eq('variant_id', variant_id)
      else q = q.is('variant_id', null)
      await q
    }
  }

  return NextResponse.json({ result: data })
}
