import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  const { data, error } = await supabase
    .from('event_inventory_full')
    .select('*')
    .eq('event_id', id)
    .order('product_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ inventory: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: eventId } = await params
  const body = await request.json()
  const { product_id, variant_id, delta } = body

  if (!product_id || typeof delta !== 'number' || delta === 0) {
    return NextResponse.json({ error: 'Faltan parámetros (product_id, delta)' }, { status: 400 })
  }

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

  return NextResponse.json({ result: data })
}
