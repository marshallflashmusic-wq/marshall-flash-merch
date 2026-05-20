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
  const { pack_id, delta, warehouse_id } = body

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

  // Asignar componente a componente delegando en el endpoint estándar (que ya
  // sabe restar de warehouse_stock cuando hay almacén origen).
  const applied: { product_id: string; qty: number }[] = []
  try {
    for (const it of items) {
      const qty = it.quantity * delta
      const res = await fetch(new URL(`/api/events/${eventId}/inventory`, request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: it.product_id,
          variant_id: null,
          delta: qty,
          warehouse_id: warehouse_id ?? null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? 'Error')
      }
      applied.push({ product_id: it.product_id, qty })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    // Rollback manual
    for (const a of applied) {
      await fetch(new URL(`/api/events/${eventId}/inventory`, request.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: a.product_id, variant_id: null, delta: -a.qty, warehouse_id: warehouse_id ?? null }),
      }).catch(() => {})
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 409 })
  }
}
