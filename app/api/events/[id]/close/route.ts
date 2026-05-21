import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Alloc = { wh_id: string; qty: number }
type RestoreItem = { product_id: string; variant_id: string | null; warehouse_id: string; quantity: number }

async function upsertWarehouseStock(
  supabase: ReturnType<typeof getServiceClient>,
  warehouseId: string,
  productId: string,
  variantId: string | null,
  qty: number,
) {
  if (qty <= 0) return
  let q = supabase
    .from('warehouse_stock')
    .select('id, quantity')
    .eq('warehouse_id', warehouseId)
    .eq('product_id', productId)
  if (variantId) q = q.eq('variant_id', variantId)
  else q = q.is('variant_id', null)
  const { data: existing } = await q.maybeSingle()

  if (existing) {
    await supabase
      .from('warehouse_stock')
      .update({ quantity: existing.quantity + qty, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabase
      .from('warehouse_stock')
      .insert({ warehouse_id: warehouseId, product_id: productId, variant_id: variantId ?? null, quantity: qty })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  // Plan de restauración opcional desde el cliente
  let clientRestorations: RestoreItem[] | null = null
  try {
    const body = await request.json()
    clientRestorations = body.restorations ?? null
  } catch { /* sin body */ }

  // Si no viene plan del cliente, leer inventario para LIFO automático
  type PendingRow = {
    product_id: string
    variant_id: string | null
    quantity_assigned: number
    quantity_sold: number
    warehouse_id: string | null
    warehouse_allocations: Alloc[]
  }
  let lifoRows: PendingRow[] = []
  if (!clientRestorations) {
    const { data: pendingInv } = await supabase
      .from('event_inventory')
      .select('product_id, variant_id, quantity_assigned, quantity_sold, warehouse_id, warehouse_allocations')
      .eq('event_id', id)
    lifoRows = ((pendingInv ?? []) as PendingRow[]).filter(
      r => (r.quantity_assigned - r.quantity_sold) > 0
    )
  }

  const { data, error } = await supabase.rpc('close_event', { p_event_id: id })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('EVENTO_YA_CERRADO')) {
      return NextResponse.json({ error: 'El concierto ya está cerrado.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  if (clientRestorations) {
    // Usar el plan elegido por el usuario
    for (const r of clientRestorations) {
      if (!r.warehouse_id || r.quantity <= 0) continue
      await upsertWarehouseStock(supabase, r.warehouse_id, r.product_id, r.variant_id, r.quantity)
    }
  } else {
    // LIFO automático
    for (const row of lifoRows) {
      const remaining = row.quantity_assigned - row.quantity_sold
      if (remaining <= 0) continue

      const allocs: Alloc[] = row.warehouse_allocations ?? []
      const stackCopy = [...allocs]
      const restorations: { wh_id: string; qty: number }[] = []
      let toReturn = remaining

      while (toReturn > 0 && stackCopy.length > 0) {
        const top = stackCopy[stackCopy.length - 1]
        const take = Math.min(top.qty, toReturn)
        restorations.push({ wh_id: top.wh_id, qty: take })
        toReturn -= take
        if (take === top.qty) stackCopy.pop()
        else stackCopy[stackCopy.length - 1] = { wh_id: top.wh_id, qty: top.qty - take }
      }
      if (toReturn > 0 && row.warehouse_id) {
        restorations.push({ wh_id: row.warehouse_id, qty: toReturn })
      }

      for (const r of restorations) {
        await upsertWarehouseStock(supabase, r.wh_id, row.product_id, row.variant_id, r.qty)
      }
    }
  }

  return NextResponse.json({ result: data })
}
