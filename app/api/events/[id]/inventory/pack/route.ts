import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// POST { pack_id, delta }
// Asigna `delta` packs al evento: para cada pack_item llama assign_event_stock
// con quantity = pack_item.quantity * delta, variant_id = NULL.
// Si algún componente del pack tiene variantes (Textil), responde 400 y pide
// que el admin asigne ese producto por talla individualmente.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: eventId } = await params
  const body = await request.json()
  const { pack_id, delta } = body

  if (!pack_id || typeof delta !== 'number' || delta === 0) {
    return NextResponse.json({ error: 'Faltan parámetros (pack_id, delta)' }, { status: 400 })
  }

  // Cargar pack_items con sus productos para detectar textil
  const { data: items, error: itemsErr } = await supabase
    .from('pack_items')
    .select('product_id, quantity, product:products(id, name, variants:product_variants(id))')
    .eq('pack_id', pack_id)

  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'Pack sin componentes' }, { status: 400 })
  }

  // Validar: ningún componente debe ser textil (con variantes)
  type ProductWithVariants = { id: string; name: string; variants: { id: string }[] }
  const textilComponents = items
    .map(it => it.product as unknown as ProductWithVariants)
    .filter(p => p && Array.isArray(p.variants) && p.variants.length > 0)
  if (textilComponents.length > 0) {
    const names = textilComponents.map(p => p.name).join(', ')
    return NextResponse.json(
      { error: `El pack tiene productos por talla (${names}). Asigna su stock al evento por talla individualmente.` },
      { status: 400 }
    )
  }

  // Asignar atómicamente cada componente. Si uno falla, intentar revertir los previos.
  const applied: { product_id: string; qty: number }[] = []
  try {
    for (const it of items) {
      const qty = it.quantity * delta
      const { error } = await supabase.rpc('assign_event_stock', {
        p_event_id: eventId,
        p_product_id: it.product_id,
        p_variant_id: null,
        p_delta: qty,
      })
      if (error) throw new Error(error.message)
      applied.push({ product_id: it.product_id, qty })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    // Rollback manual: revertir lo aplicado
    for (const a of applied) {
      await supabase.rpc('assign_event_stock', {
        p_event_id: eventId,
        p_product_id: a.product_id,
        p_variant_id: null,
        p_delta: -a.qty,
      })
    }
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('STOCK_GLOBAL_INSUFICIENTE')) {
      return NextResponse.json({ error: 'No hay suficiente stock global de uno de los componentes.' }, { status: 409 })
    }
    if (msg.includes('NO_PUEDE_DESASIGNAR_VENDIDO')) {
      return NextResponse.json({ error: 'No se puede desasignar: hay packs ya vendidos en el evento.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
