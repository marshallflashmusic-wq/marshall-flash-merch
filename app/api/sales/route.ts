import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)

  let query = supabase
    .from('sales')
    .select(`
      *,
      event:events(id, name, city),
      user:profiles(id, name),
      items:sale_items(
        *,
        product:products(id, name, image_url),
        pack:packs(id, name)
      )
    `, { count: 'exact' })
    .order('created_at', { ascending: false })

  const date_from = searchParams.get('date_from')
  const date_to = searchParams.get('date_to')
  const event_id = searchParams.get('event_id')
  const user_id = searchParams.get('user_id')
  const payment_method = searchParams.get('payment_method')

  if (date_from) query = query.gte('created_at', date_from)
  if (date_to) query = query.lte('created_at', date_to + 'T23:59:59')
  if (event_id) query = query.eq('event_id', event_id)
  if (user_id) query = query.eq('user_id', user_id)
  if (payment_method) query = query.eq('payment_method', payment_method)

  const { data, count, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sales: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getServiceClient()
    const body = await request.json()
    const { saleData, items, stockDecrements, idempotencyKey } = body

    // Resolver user_id: si viene null (TPV sin sesión Supabase), usar admin como FK fallback
    let userId = saleData.user_id
    if (!userId) {
      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(1)
        .single()
      userId = adminProfile?.id ?? null
    }

    const resolvedSaleData = { ...saleData, user_id: userId, synced: true }

    // process_sale ejecuta TODO en una sola transacción PostgreSQL:
    // valida stock (con row lock), crea venta, inserta items, decrementa stock,
    // registra inventory_movements. Si algo falla → rollback automático completo.
    const { data: result, error: rpcError } = await supabase.rpc('process_sale', {
      p_sale_data:        resolvedSaleData,
      p_items:            items ?? [],
      p_stock_decrements: stockDecrements ?? [],
      p_idempotency_key:  idempotencyKey ?? null,
    })

    if (rpcError) {
      console.error('[POST /api/sales] process_sale error:', rpcError.message)

      // Mensajes de error amigables para los casos más comunes
      const msg = rpcError.message ?? ''
      if (msg.includes('STOCK_INSUFICIENTE')) {
        return NextResponse.json(
          { error: 'Stock agotado. Otro vendedor puede haber vendido el mismo artículo.' },
          { status: 409 }
        )
      }
      if (msg.includes('PRODUCTO_NO_ENCONTRADO')) {
        return NextResponse.json(
          { error: 'Uno de los productos ya no existe en el sistema.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    // Decrementar stock de variantes (tallas) cuando aplica
    const variantDecrements = (stockDecrements ?? []).filter(
      (d: { variant_id?: string; quantity: number }) => d.variant_id
    )
    for (const decr of variantDecrements as { variant_id: string; quantity: number }[]) {
      const { data: v } = await supabase
        .from('product_variants')
        .select('stock')
        .eq('id', decr.variant_id)
        .single()
      if (v) {
        await supabase
          .from('product_variants')
          .update({ stock: Math.max(0, v.stock - decr.quantity), updated_at: new Date().toISOString() })
          .eq('id', decr.variant_id)
      }
    }

    const saleId = (result as { sale_id: string; duplicate: boolean })?.sale_id
    return NextResponse.json({ sale: { id: saleId } })
  } catch (e) {
    console.error('[POST /api/sales] excepción no capturada:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { id, total_amount, payment_method, notes } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updateData: Record<string, unknown> = {}
  if (payment_method !== undefined) updateData.payment_method = payment_method
  if (notes !== undefined) updateData.notes = notes || null

  if (total_amount !== undefined) {
    updateData.total_amount = Number(total_amount)
    const { data: current } = await supabase
      .from('sales').select('total_cost').eq('id', id).single()
    if (current) updateData.profit = Number(total_amount) - (current.total_cost ?? 0)
  }

  const { data, error } = await supabase
    .from('sales')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sale: data })
}

export async function DELETE(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const restoreStock = searchParams.get('restoreStock') === 'true'

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (restoreStock) {
    const { data: items } = await supabase
      .from('sale_items')
      .select('product_id, pack_id, quantity')
      .eq('sale_id', id)

    const stockIncrements: Record<string, number> = {}

    for (const item of items ?? []) {
      if (item.product_id) {
        stockIncrements[item.product_id] = (stockIncrements[item.product_id] ?? 0) + item.quantity
      } else if (item.pack_id) {
        const { data: packItems } = await supabase
          .from('pack_items')
          .select('product_id, quantity')
          .eq('pack_id', item.pack_id)
        for (const pi of packItems ?? []) {
          stockIncrements[pi.product_id] = (stockIncrements[pi.product_id] ?? 0) + pi.quantity * item.quantity
        }
      }
    }

    for (const [productId, qty] of Object.entries(stockIncrements)) {
      const { error: rpcError } = await supabase.rpc('increment_stock', {
        p_product_id: productId,
        p_quantity: qty,
        p_sale_id: id,
      })
      if (rpcError) {
        const { data: prod } = await supabase
          .from('products').select('stock').eq('id', productId).single()
        if (prod) {
          await supabase.from('products').update({
            stock: prod.stock + qty,
            updated_at: new Date().toISOString(),
          }).eq('id', productId)
        }
      }
    }
  }

  const { error } = await supabase.from('sales').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
