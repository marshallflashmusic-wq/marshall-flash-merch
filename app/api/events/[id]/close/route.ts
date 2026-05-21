import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  // Leer inventario pendiente ANTES de cerrar, para saber qué devolver a los almacenes.
  const { data: pendingInv } = await supabase
    .from('event_inventory')
    .select('product_id, variant_id, quantity_assigned, quantity_sold, warehouse_id')
    .eq('event_id', id)

  const toRestore = (pendingInv ?? []).filter(
    r => r.warehouse_id && (r.quantity_assigned - r.quantity_sold) > 0
  )

  const { data, error } = await supabase.rpc('close_event', { p_event_id: id })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('EVENTO_YA_CERRADO')) {
      return NextResponse.json({ error: 'El concierto ya está cerrado.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Devolver las unidades no vendidas a sus almacenes de origen.
  for (const row of toRestore) {
    const remaining = row.quantity_assigned - row.quantity_sold
    if (remaining <= 0) continue
    let q = supabase
      .from('warehouse_stock')
      .select('id, quantity')
      .eq('warehouse_id', row.warehouse_id)
      .eq('product_id', row.product_id)
    if (row.variant_id) q = q.eq('variant_id', row.variant_id)
    else q = q.is('variant_id', null)
    const { data: existing } = await q.maybeSingle()
    if (existing) {
      await supabase
        .from('warehouse_stock')
        .update({ quantity: existing.quantity + remaining, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('warehouse_stock')
        .insert({ warehouse_id: row.warehouse_id, product_id: row.product_id, variant_id: row.variant_id ?? null, quantity: remaining })
    }
  }

  return NextResponse.json({ result: data })
}
