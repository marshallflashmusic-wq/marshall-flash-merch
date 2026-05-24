import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ events: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { name, city, venue, date, notes, actor_id, actor_name, actor_role } = body

  if (!name || !city || !venue || !date) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('events')
    .insert({
      name: String(name).trim(),
      city: String(city).trim(),
      venue: String(venue).trim(),
      date,
      notes: notes ? String(notes).trim() : null,
      status: 'upcoming',
      active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (actor_name) {
    await logAudit(supabase, {
      action: 'event_created',
      actor_id, actor_name, actor_role: actor_role ?? 'admin',
      entity_type: 'event',
      entity_id: data.id,
      entity_name: data.name,
      metadata: { city: data.city, venue: data.venue, date: data.date },
    })
  }

  return NextResponse.json({ event: data })
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { id, ...patch } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const allowed = ['name', 'city', 'venue', 'date', 'notes', 'status', 'active']
  const updateData: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in patch) updateData[k] = patch[k]
  }

  const { data, error } = await supabase
    .from('events')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ event: data })
}

export async function DELETE(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const restoreStock = searchParams.get('restoreStock') === 'true'
  const deleteSales = searchParams.get('deleteSales') === 'true'
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Actor info + opciones de restauración desde el body del DELETE
  let actor_id: string | null = null
  let actor_name: string | null = null
  let actor_role: string = 'admin'
  let eventName: string | null = null
  // restoreMode: 'origin' (LIFO por almacén origen) | 'custom' (todo a targetWarehouseId) | 'none'
  let restoreMode: 'origin' | 'custom' | 'none' = restoreStock ? 'origin' : 'none'
  let targetWarehouseId: string | null = null
  try {
    const body = await request.json()
    actor_id   = body.actor_id   ?? null
    actor_name = body.actor_name ?? null
    actor_role = body.actor_role ?? 'admin'
    eventName  = body.event_name ?? null
    if (body.restoreMode === 'origin' || body.restoreMode === 'custom' || body.restoreMode === 'none') {
      restoreMode = body.restoreMode
    }
    targetWarehouseId = body.targetWarehouseId ?? null
  } catch { /* sin body */ }

  // Contar ventas asociadas
  const { data: salesRows, error: salesErr } = await supabase
    .from('sales')
    .select('id')
    .eq('event_id', id)
  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })
  const saleCount = salesRows?.length ?? 0

  if (saleCount > 0 && !deleteSales) {
    return NextResponse.json(
      {
        error: `El evento tiene ${saleCount} venta${saleCount !== 1 ? 's' : ''}. Marca "Eliminar ventas" para borrarlo de todas formas.`,
        hasSales: true,
        saleCount,
      },
      { status: 409 }
    )
  }

  if (saleCount > 0 && deleteSales) {
    for (const s of salesRows ?? []) {
      if (restoreStock) {
        // 1) Restaurar stock global + bajar event_inventory.quantity_sold
        const { error: rpcErr } = await supabase.rpc('restore_sale_stock', { p_sale_id: s.id })
        if (rpcErr) {
          console.warn('[DELETE /api/events] restore_sale_stock fallo:', rpcErr.message)
        }

        // 2) Devolver el stock físico al almacén de procedencia (warehouse_stock).
        //    Prioriza sale_items.warehouse_id; fallback a event_inventory.warehouse_id.
        type RestoreMov = { product_id: string; variant_id: string | null; quantity: number; warehouse_id: string }
        const restoreToWarehouse: RestoreMov[] = []

        const { data: itemRows } = await supabase
          .from('sale_items')
          .select('product_id, pack_id, quantity, warehouse_id')
          .eq('sale_id', s.id)

        const packIds = Array.from(new Set(
          (itemRows ?? []).map(r => r.pack_id).filter(Boolean) as string[]
        ))
        const packItemsByPack = new Map<string, { product_id: string; quantity: number }[]>()
        if (packIds.length > 0) {
          const { data: packItemRows } = await supabase
            .from('pack_items')
            .select('pack_id, product_id, quantity')
            .in('pack_id', packIds)
          for (const pi of packItemRows ?? []) {
            const arr = packItemsByPack.get(pi.pack_id) ?? []
            arr.push({ product_id: pi.product_id, quantity: pi.quantity })
            packItemsByPack.set(pi.pack_id, arr)
          }
        }

        const coveredProducts = new Set<string>()
        const resolveWh = (defaultWh: string) => restoreMode === 'custom' && targetWarehouseId
          ? targetWarehouseId
          : defaultWh
        for (const r of itemRows ?? []) {
          // En modo custom, no necesitamos un warehouse origen: vamos todos al targetWarehouseId
          const baseWh = r.warehouse_id ?? (restoreMode === 'custom' ? targetWarehouseId : null)
          if (!baseWh) continue
          if (r.product_id) {
            restoreToWarehouse.push({ product_id: r.product_id, variant_id: null, quantity: r.quantity, warehouse_id: resolveWh(baseWh) })
            coveredProducts.add(r.product_id)
          } else if (r.pack_id) {
            for (const pi of packItemsByPack.get(r.pack_id) ?? []) {
              restoreToWarehouse.push({ product_id: pi.product_id, variant_id: null, quantity: pi.quantity * r.quantity, warehouse_id: resolveWh(baseWh) })
              coveredProducts.add(pi.product_id)
            }
          }
        }

        // Fallback: event_inventory para ventas antiguas sin warehouse en sale_items
        const { data: movs } = await supabase
          .from('inventory_movements')
          .select('product_id, quantity, event_inventory_id')
          .eq('reference_id', s.id)
          .in('type', ['sale', 'pack_sale'])
        const eventInvIds = Array.from(new Set((movs ?? []).map((m: { event_inventory_id?: string }) => m.event_inventory_id).filter(Boolean))) as string[]
        let whByInv = new Map<string, { warehouse_id: string | null; variant_id: string | null }>()
        if (eventInvIds.length > 0) {
          const { data: einvRows } = await supabase
            .from('event_inventory')
            .select('id, warehouse_id, variant_id')
            .in('id', eventInvIds)
          whByInv = new Map((einvRows ?? []).map(r => [r.id, { warehouse_id: r.warehouse_id ?? null, variant_id: r.variant_id ?? null }]))
        }
        for (const m of movs ?? []) {
          const inv = m.event_inventory_id ? whByInv.get(m.event_inventory_id) : undefined
          const baseWh = inv?.warehouse_id ?? (restoreMode === 'custom' ? targetWarehouseId : null)
          if (!baseWh) continue
          if (coveredProducts.has(m.product_id)) continue
          restoreToWarehouse.push({
            product_id: m.product_id,
            variant_id: inv?.variant_id ?? null,
            quantity: m.quantity,
            warehouse_id: resolveWh(baseWh),
          })
        }

        for (const mov of restoreToWarehouse) {
          let q = supabase
            .from('warehouse_stock')
            .select('id, quantity')
            .eq('warehouse_id', mov.warehouse_id)
            .eq('product_id', mov.product_id)
          if (mov.variant_id) q = q.eq('variant_id', mov.variant_id)
          else q = q.is('variant_id', null)
          const { data: row } = await q.maybeSingle()
          if (row) {
            await supabase
              .from('warehouse_stock')
              .update({ quantity: (row.quantity ?? 0) + mov.quantity, updated_at: new Date().toISOString() })
              .eq('id', row.id)
          } else {
            await supabase
              .from('warehouse_stock')
              .insert({ warehouse_id: mov.warehouse_id, product_id: mov.product_id, variant_id: mov.variant_id, quantity: mov.quantity })
          }
        }
      }
      await supabase.from('sales').delete().eq('id', s.id)
    }
  }

  // Devolver el SOBRANTE (stock asignado pero no vendido) al almacén origen.
  // Tras restaurar ventas, quantity_sold queda a 0; el leftover real es quantity_assigned.
  // Distribuimos usando warehouse_allocations (LIFO) o, como fallback, event_inventory.warehouse_id.
  if (restoreStock) {
    type Alloc = { wh_id: string; qty: number }
    type EinvRow = {
      product_id: string
      variant_id: string | null
      quantity_assigned: number
      quantity_sold: number
      warehouse_id: string | null
      warehouse_allocations: Alloc[] | null
    }
    const { data: einvRows } = await supabase
      .from('event_inventory')
      .select('product_id, variant_id, quantity_assigned, quantity_sold, warehouse_id, warehouse_allocations')
      .eq('event_id', id)

    for (const row of (einvRows ?? []) as EinvRow[]) {
      const leftover = (row.quantity_assigned ?? 0) - (row.quantity_sold ?? 0)
      if (leftover <= 0) continue

      const plan: { wh_id: string; qty: number }[] = []
      if (restoreMode === 'custom' && targetWarehouseId) {
        // Todo el sobrante va a un único almacén destino
        plan.push({ wh_id: targetWarehouseId, qty: leftover })
      } else {
        const allocs: Alloc[] = Array.isArray(row.warehouse_allocations) ? [...row.warehouse_allocations] : []
        let toReturn = leftover
        while (toReturn > 0 && allocs.length > 0) {
          const top = allocs[allocs.length - 1]
          const take = Math.min(top.qty, toReturn)
          plan.push({ wh_id: top.wh_id, qty: take })
          toReturn -= take
          if (take === top.qty) allocs.pop()
          else allocs[allocs.length - 1] = { wh_id: top.wh_id, qty: top.qty - take }
        }
        if (toReturn > 0 && row.warehouse_id) {
          plan.push({ wh_id: row.warehouse_id, qty: toReturn })
        }
      }

      for (const p of plan) {
        if (p.qty <= 0) continue
        let q = supabase
          .from('warehouse_stock')
          .select('id, quantity')
          .eq('warehouse_id', p.wh_id)
          .eq('product_id', row.product_id)
        if (row.variant_id) q = q.eq('variant_id', row.variant_id)
        else q = q.is('variant_id', null)
        const { data: ws } = await q.maybeSingle()
        if (ws) {
          await supabase
            .from('warehouse_stock')
            .update({ quantity: (ws.quantity ?? 0) + p.qty, updated_at: new Date().toISOString() })
            .eq('id', ws.id)
        } else {
          await supabase
            .from('warehouse_stock')
            .insert({
              warehouse_id: p.wh_id,
              product_id: row.product_id,
              variant_id: row.variant_id,
              quantity: p.qty,
            })
        }
      }
    }
  }

  await supabase.from('event_inventory').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (actor_name) {
    await logAudit(supabase, {
      action: 'event_deleted',
      actor_id, actor_name, actor_role,
      entity_type: 'event',
      entity_id: id,
      entity_name: eventName,
      metadata: { saleCount, restoreStock, deleteSales },
    })
  }

  return NextResponse.json({ success: true })
}
