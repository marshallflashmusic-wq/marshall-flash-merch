import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type SB = ReturnType<typeof getServiceClient>
type Alloc = { wh_id: string; qty: number }

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  const [fullRes, baseRes] = await Promise.all([
    supabase.from('event_inventory_full').select('*').eq('event_id', id).order('product_name'),
    supabase.from('event_inventory').select('id, warehouse_id, warehouse_allocations').eq('event_id', id),
  ])
  if (fullRes.error) return NextResponse.json({ error: fullRes.error.message }, { status: 500 })

  const baseById = new Map<string, { warehouse_id: string | null; warehouse_allocations: Alloc[] }>()
  for (const r of baseRes.data ?? []) {
    baseById.set(r.id, {
      warehouse_id: r.warehouse_id ?? null,
      warehouse_allocations: (r.warehouse_allocations as Alloc[]) ?? [],
    })
  }
  const merged = (fullRes.data ?? []).map(row => ({
    ...row,
    warehouse_id: baseById.get(row.id)?.warehouse_id ?? null,
    warehouse_allocations: baseById.get(row.id)?.warehouse_allocations ?? [],
  }))
  return NextResponse.json({ inventory: merged })
}

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

  // Leer fila actual: warehouse_id y warehouse_allocations (stack LIFO)
  let rowQ = supabase
    .from('event_inventory')
    .select('id, warehouse_id, warehouse_allocations')
    .eq('event_id', eventId)
    .eq('product_id', product_id)
  if (variant_id) rowQ = rowQ.eq('variant_id', variant_id)
  else rowQ = rowQ.is('variant_id', null)
  const { data: existingRow } = await rowQ.maybeSingle()

  const currentAllocs: Alloc[] = (existingRow?.warehouse_allocations as Alloc[]) ?? []
  const effectiveWarehouseId: string | null = warehouse_id ?? null

  // Pre-validación: si delta > 0 y se especificó almacén, verificar stock antes de tocar event_inventory
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

  // RPC para validar y actualizar event_inventory (atómico en Postgres)
  const { data, error } = await supabase.rpc('assign_event_stock', {
    p_event_id: eventId,
    p_product_id: product_id,
    p_variant_id: variant_id ?? null,
    p_delta: delta,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('STOCK_GLOBAL_INSUFICIENTE'))
      return NextResponse.json({ error: 'No hay suficiente stock global para asignar.' }, { status: 409 })
    if (msg.includes('STOCK_VARIANTE_INSUFICIENTE'))
      return NextResponse.json({ error: 'No hay suficiente stock de esta talla.' }, { status: 409 })
    if (msg.includes('NO_PUEDE_DESASIGNAR_VENDIDO'))
      return NextResponse.json({ error: 'No se puede desasignar: hay unidades ya vendidas en el evento.' }, { status: 409 })
    if (msg.includes('EVENTO_CERRADO'))
      return NextResponse.json({ error: 'El evento está cerrado o cancelado.' }, { status: 409 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Actualizar warehouse_stock y el stack LIFO de allocations
  let newAllocs = [...currentAllocs]
  let newWarehouseId = existingRow?.warehouse_id ?? null

  if (delta > 0 && effectiveWarehouseId) {
    // Asignando stock desde un almacén: descontar del almacén
    const whErr = await addToWarehouseStock(supabase, effectiveWarehouseId, product_id, variant_id ?? null, -delta)
    if (whErr) {
      // Revertir el RPC
      await supabase.rpc('assign_event_stock', {
        p_event_id: eventId,
        p_product_id: product_id,
        p_variant_id: variant_id ?? null,
        p_delta: -delta,
      })
      return NextResponse.json({
        error: whErr === 'STOCK_ALMACEN_INSUFICIENTE' ? 'No hay stock suficiente en el almacén origen.' : whErr,
      }, { status: 409 })
    }
    // Push al stack LIFO (merge si el último es el mismo almacén)
    if (newAllocs.length > 0 && newAllocs[newAllocs.length - 1].wh_id === effectiveWarehouseId) {
      newAllocs[newAllocs.length - 1] = {
        wh_id: effectiveWarehouseId,
        qty: newAllocs[newAllocs.length - 1].qty + delta,
      }
    } else {
      newAllocs.push({ wh_id: effectiveWarehouseId, qty: delta })
    }
    newWarehouseId = effectiveWarehouseId

  } else if (delta < 0) {
    // Devolviendo stock al almacén de origen (LIFO)
    let toReturn = -delta // positivo

    // Si se especificó almacén explícitamente, devolver directamente allí
    if (effectiveWarehouseId) {
      await addToWarehouseStock(supabase, effectiveWarehouseId, product_id, variant_id ?? null, toReturn)
      // Ajustar el stack: quitar las unidades del stack en LIFO pero solo para el wh especificado
      // En este caso simplificamos y vaciamos las unidades del stack genéricamente
      let remaining = toReturn
      while (remaining > 0 && newAllocs.length > 0) {
        const top = newAllocs[newAllocs.length - 1]
        if (top.qty <= remaining) { remaining -= top.qty; newAllocs.pop() }
        else { newAllocs[newAllocs.length - 1] = { wh_id: top.wh_id, qty: top.qty - remaining }; remaining = 0 }
      }
    } else {
      // LIFO puro: distribuir entre almacenes según el stack
      const restorations: Alloc[] = []
      while (toReturn > 0 && newAllocs.length > 0) {
        const top = newAllocs[newAllocs.length - 1]
        const take = Math.min(top.qty, toReturn)
        restorations.push({ wh_id: top.wh_id, qty: take })
        toReturn -= take
        if (take === top.qty) newAllocs.pop()
        else newAllocs[newAllocs.length - 1] = { wh_id: top.wh_id, qty: top.qty - take }
      }
      // Fallback: unidades sin stack conocido → usar warehouse_id genérico
      if (toReturn > 0 && existingRow?.warehouse_id) {
        restorations.push({ wh_id: existingRow.warehouse_id, qty: toReturn })
      }
      for (const r of restorations) {
        await addToWarehouseStock(supabase, r.wh_id, product_id, variant_id ?? null, r.qty)
      }
    }
    newWarehouseId = newAllocs.length > 0 ? newAllocs[newAllocs.length - 1].wh_id : existingRow?.warehouse_id ?? null
  }

  // Persistir warehouse_allocations y warehouse_id actualizados.
  // Importante: se ejecuta SIEMPRE (también en la primera asignación, cuando
  // la fila se creó dentro del RPC), no solo si existingRow ya existía.
  // Si no, warehouse_id y warehouse_allocations se quedan en NULL para
  // siempre y luego el sistema dice "almacén sin determinar".
  {
    let updateQ = supabase
      .from('event_inventory')
      .update({
        warehouse_allocations: newAllocs,
        warehouse_id: newWarehouseId,
        updated_at: new Date().toISOString(),
      })
      .eq('event_id', eventId)
      .eq('product_id', product_id)
    if (variant_id) updateQ = updateQ.eq('variant_id', variant_id)
    else updateQ = updateQ.is('variant_id', null)
    const { error: updErr } = await updateQ
    if (updErr) {
      console.error('[POST events/inventory] no se pudo persistir warehouse_id/allocations:', updErr.message)
    }
  }

  return NextResponse.json({ result: data })
}
