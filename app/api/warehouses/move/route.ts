import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { from_warehouse_id, to_warehouse_id, product_id, variant_id, quantity } = body

  if (!from_warehouse_id || !to_warehouse_id || !product_id || !quantity || quantity <= 0) {
    return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 })
  }
  if (from_warehouse_id === to_warehouse_id) {
    return NextResponse.json({ error: 'El almacén de origen y destino son el mismo' }, { status: 400 })
  }

  // Verificar stock suficiente en origen
  let srcQ = supabase
    .from('warehouse_stock')
    .select('id, quantity')
    .eq('warehouse_id', from_warehouse_id)
    .eq('product_id', product_id)
  if (variant_id) srcQ = srcQ.eq('variant_id', variant_id)
  else srcQ = srcQ.is('variant_id', null)
  const { data: srcRow } = await srcQ.maybeSingle()

  if (!srcRow || srcRow.quantity < quantity) {
    return NextResponse.json(
      { error: `Stock insuficiente en almacén origen (disponible: ${srcRow?.quantity ?? 0})` },
      { status: 409 }
    )
  }

  // Decrementar origen
  const newSrcQty = srcRow.quantity - quantity
  if (newSrcQty === 0) {
    const { error } = await supabase.from('warehouse_stock').delete().eq('id', srcRow.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('warehouse_stock')
      .update({ quantity: newSrcQty, updated_at: new Date().toISOString() })
      .eq('id', srcRow.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Incrementar destino (upsert)
  let dstQ = supabase
    .from('warehouse_stock')
    .select('id, quantity')
    .eq('warehouse_id', to_warehouse_id)
    .eq('product_id', product_id)
  if (variant_id) dstQ = dstQ.eq('variant_id', variant_id)
  else dstQ = dstQ.is('variant_id', null)
  const { data: dstRow } = await dstQ.maybeSingle()

  if (dstRow) {
    await supabase
      .from('warehouse_stock')
      .update({ quantity: dstRow.quantity + quantity, updated_at: new Date().toISOString() })
      .eq('id', dstRow.id)
  } else {
    await supabase
      .from('warehouse_stock')
      .insert({ warehouse_id: to_warehouse_id, product_id, variant_id: variant_id ?? null, quantity })
  }

  return NextResponse.json({ success: true, moved: quantity })
}
