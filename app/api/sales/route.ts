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
  const amount_min = searchParams.get('amount_min')
  const amount_max = searchParams.get('amount_max')

  if (date_from) query = query.gte('created_at', date_from)
  if (date_to) query = query.lte('created_at', date_to + 'T23:59:59')
  if (event_id) query = query.eq('event_id', event_id)
  if (user_id) query = query.eq('user_id', user_id)
  if (payment_method) query = query.eq('payment_method', payment_method)
  if (amount_min) query = query.gte('total_amount', parseFloat(amount_min))
  if (amount_max) query = query.lte('total_amount', parseFloat(amount_max))

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

    // Decrementar stock de variantes (tallas) — SOLO en venta rápida.
    // En venta de evento, la variant ya se descontó al asignar; el descuento por venta
    // se aplica únicamente sobre event_inventory.quantity_sold (gestionado en process_sale).
    const variantDecrements = (stockDecrements ?? []).filter(
      (d: { variant_id?: string; quantity: number; event_inventory_id?: string }) => d.variant_id && !d.event_inventory_id
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

    // Para ventas EN CONCIERTO con almacén origen registrado, descontar
    // warehouse_stock del almacén indicado en event_inventory.warehouse_id.
    // Así el almacén refleja que esas unidades ya no están físicamente allí.
    const eventDecrements = (stockDecrements ?? []).filter(
      (d: { event_inventory_id?: string; product_id: string; variant_id?: string; quantity: number }) => !!d.event_inventory_id
    ) as { event_inventory_id: string; product_id: string; variant_id?: string; quantity: number }[]
    for (const d of eventDecrements) {
      const { data: einv } = await supabase
        .from('event_inventory')
        .select('warehouse_id')
        .eq('id', d.event_inventory_id)
        .single()
      const whId = einv?.warehouse_id
      if (!whId) continue
      let q = supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('warehouse_id', whId)
        .eq('product_id', d.product_id)
      if (d.variant_id) q = q.eq('variant_id', d.variant_id)
      else q = q.is('variant_id', null)
      const { data: row } = await q.maybeSingle()
      if (!row) continue
      const next = Math.max(0, (row.quantity ?? 0) - d.quantity)
      if (next === 0) {
        await supabase.from('warehouse_stock').delete().eq('id', row.id)
      } else {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: next, updated_at: new Date().toISOString() })
          .eq('id', row.id)
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

  // Plan de restauración de almacén elegido por el usuario (opcional)
  type WhRestoreItem = { product_id: string; variant_id: string | null; warehouse_id: string; quantity: number }
  let clientRestorations: WhRestoreItem[] | null = null
  try {
    const body = await request.json()
    if (Array.isArray(body.restorations)) clientRestorations = body.restorations
  } catch { /* sin body */ }

  if (restoreStock) {
    // restore_sale_stock revierte ventas globales y de evento usando inventory_movements.
    const { error: rpcError } = await supabase.rpc('restore_sale_stock', { p_sale_id: id })
    if (rpcError) {
      // Fallback si la función no está disponible
      console.warn('[DELETE /api/sales] restore_sale_stock no disponible, usando fallback:', rpcError.message)
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

  // Restaurar warehouse_stock: plan del cliente si existe, si no auto-detección
  if (clientRestorations && clientRestorations.length > 0) {
    for (const r of clientRestorations) {
      if (!r.warehouse_id || r.quantity <= 0) continue
      let q = supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('warehouse_id', r.warehouse_id)
        .eq('product_id', r.product_id)
      if (r.variant_id) q = q.eq('variant_id', r.variant_id)
      else q = q.is('variant_id', null)
      const { data: row } = await q.maybeSingle()
      if (row) {
        await supabase
          .from('warehouse_stock')
          .update({ quantity: (row.quantity ?? 0) + r.quantity, updated_at: new Date().toISOString() })
          .eq('id', row.id)
      } else {
        await supabase
          .from('warehouse_stock')
          .insert({ warehouse_id: r.warehouse_id, product_id: r.product_id, variant_id: r.variant_id ?? null, quantity: r.quantity })
      }
    }
  } else if (restoreStock) {
    // Auto-detección: buscar warehouse_id en event_inventory a través de inventory_movements
    type RestoreMov = { product_id: string; variant_id: string | null; quantity: number; warehouse_id: string }
    const { data: movs } = await supabase
      .from('inventory_movements')
      .select('product_id, quantity, event_inventory_id')
      .eq('reference_id', id)
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
    const restoreToWarehouse: RestoreMov[] = (movs ?? [])
      .map((m: { product_id: string; quantity: number; event_inventory_id?: string }) => {
        const inv = m.event_inventory_id ? whByInv.get(m.event_inventory_id) : undefined
        return inv?.warehouse_id
          ? { product_id: m.product_id, variant_id: inv.variant_id ?? null, quantity: m.quantity, warehouse_id: inv.warehouse_id }
          : null
      })
      .filter((x): x is RestoreMov => !!x)

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

  const { error } = await supabase.from('sales').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
