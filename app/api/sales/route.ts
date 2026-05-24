import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

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
        pack:packs(id, name),
        warehouse:warehouses(id, name)
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

    // Para ventas RÁPIDAS con almacén seleccionado, descontar warehouse_stock
    const quickWarehouseDecrements = (stockDecrements ?? []).filter(
      (d: { warehouse_id?: string; event_inventory_id?: string }) => !!d.warehouse_id && !d.event_inventory_id
    ) as { warehouse_id: string; product_id: string; variant_id?: string; quantity: number }[]

    for (const d of quickWarehouseDecrements) {
      let q = supabase
        .from('warehouse_stock')
        .select('id, quantity')
        .eq('warehouse_id', d.warehouse_id)
        .eq('product_id', d.product_id)
      if (d.variant_id) q = q.eq('variant_id', d.variant_id)
      else q = q.is('variant_id', null)
      const { data: row } = await q.maybeSingle()
      if (!row) continue
      const next = Math.max(0, (row.quantity ?? 0) - d.quantity)
      if (next === 0) {
        await supabase.from('warehouse_stock').delete().eq('id', row.id)
      } else {
        await supabase.from('warehouse_stock')
          .update({ quantity: next, updated_at: new Date().toISOString() })
          .eq('id', row.id)
      }
    }

    const saleId = (result as { sale_id: string; duplicate: boolean })?.sale_id
    const duplicate = (result as { sale_id: string; duplicate: boolean })?.duplicate

    // Persistir warehouse_id por item en sale_items (almacén de procedencia).
    // Para ventas de evento: resolvemos vía event_inventory.warehouse_id.
    // Para ventas rápidas: usamos directamente stockDecrement.warehouse_id.
    // En packs (un sale_item con pack_id), tomamos el warehouse del primer
    // componente que coincida (lo normal: todo el pack sale del mismo almacén).
    if (saleId && !duplicate) {
      try {
        const decrements = (stockDecrements ?? []) as {
          product_id?: string
          pack_id?: string
          warehouse_id?: string
          event_inventory_id?: string
          quantity: number
        }[]

        // Resolver warehouse por event_inventory_id en bloque
        const einvIds = Array.from(new Set(
          decrements.map(d => d.event_inventory_id).filter(Boolean) as string[]
        ))
        const einvWh = new Map<string, string | null>()
        if (einvIds.length > 0) {
          const { data: einvRows } = await supabase
            .from('event_inventory')
            .select('id, warehouse_id')
            .in('id', einvIds)
          for (const r of einvRows ?? []) einvWh.set(r.id, r.warehouse_id ?? null)
        }

        // Mapas product → warehouse y pack → warehouse
        const whByProduct = new Map<string, string>()
        const whByPack = new Map<string, string>()
        for (const d of decrements) {
          const wh = d.warehouse_id
            ?? (d.event_inventory_id ? einvWh.get(d.event_inventory_id) ?? null : null)
          if (!wh) continue
          if (d.product_id && !whByProduct.has(d.product_id)) whByProduct.set(d.product_id, wh)
          if (d.pack_id && !whByPack.has(d.pack_id)) whByPack.set(d.pack_id, wh)
        }

        // Si pack no trae warehouse_id directo, derivar del primer producto del pack
        const { data: createdItems } = await supabase
          .from('sale_items')
          .select('id, product_id, pack_id')
          .eq('sale_id', saleId)

        for (const it of createdItems ?? []) {
          let wh: string | undefined
          if (it.product_id) wh = whByProduct.get(it.product_id)
          if (!wh && it.pack_id) {
            wh = whByPack.get(it.pack_id)
            if (!wh) {
              const { data: packItems } = await supabase
                .from('pack_items')
                .select('product_id')
                .eq('pack_id', it.pack_id)
              for (const pi of packItems ?? []) {
                const cand = whByProduct.get(pi.product_id)
                if (cand) { wh = cand; break }
              }
            }
          }
          if (wh) {
            await supabase
              .from('sale_items')
              .update({ warehouse_id: wh })
              .eq('id', it.id)
          }
        }
      } catch (e) {
        console.warn('[POST /api/sales] no se pudo persistir warehouse_id en sale_items:', e)
      }
    }

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

  // Plan de restauración + actor info (opcionales desde el cliente)
  type WhRestoreItem = { product_id: string; variant_id: string | null; warehouse_id: string; quantity: number }
  let clientRestorations: WhRestoreItem[] | null = null
  let actor_id: string | null = null
  let actor_name: string | null = null
  let actor_role = 'admin'
  let sale_total: number | null = null
  let sale_event: string | null = null
  try {
    const body = await request.json()
    if (Array.isArray(body.restorations)) clientRestorations = body.restorations
    actor_id   = body.actor_id   ?? null
    actor_name = body.actor_name ?? null
    actor_role = body.actor_role ?? 'admin'
    sale_total = body.sale_total ?? null
    sale_event = body.sale_event ?? null
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
    // Auto-detección "devolver a almacenes de origen":
    // 1) Preferimos sale_items.warehouse_id (persistido al crear la venta).
    // 2) Fallback: event_inventory.warehouse_id vía inventory_movements (compat. con ventas antiguas).
    type RestoreMov = { product_id: string; variant_id: string | null; quantity: number; warehouse_id: string }
    const restoreToWarehouse: RestoreMov[] = []

    // 1) sale_items
    const { data: itemRows } = await supabase
      .from('sale_items')
      .select('product_id, pack_id, quantity, warehouse_id')
      .eq('sale_id', id)
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
    for (const r of itemRows ?? []) {
      if (!r.warehouse_id) continue
      if (r.product_id) {
        restoreToWarehouse.push({ product_id: r.product_id, variant_id: null, quantity: r.quantity, warehouse_id: r.warehouse_id })
        coveredProducts.add(`${r.product_id}::${id}`)
      } else if (r.pack_id) {
        for (const pi of packItemsByPack.get(r.pack_id) ?? []) {
          restoreToWarehouse.push({ product_id: pi.product_id, variant_id: null, quantity: pi.quantity * r.quantity, warehouse_id: r.warehouse_id })
          coveredProducts.add(`${pi.product_id}::${id}`)
        }
      }
    }

    // 2) Fallback para ventas antiguas (sale_items.warehouse_id NULL): event_inventory vía inventory_movements
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
    for (const m of movs ?? []) {
      const inv = m.event_inventory_id ? whByInv.get(m.event_inventory_id) : undefined
      if (!inv?.warehouse_id) continue
      if (coveredProducts.has(`${m.product_id}::${id}`)) continue
      restoreToWarehouse.push({
        product_id: m.product_id,
        variant_id: inv.variant_id ?? null,
        quantity: m.quantity,
        warehouse_id: inv.warehouse_id,
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

  const { error } = await supabase.from('sales').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (actor_name) {
    await logAudit(supabase, {
      action: 'sale_deleted',
      actor_id, actor_name, actor_role,
      entity_type: 'sale',
      entity_id: id,
      entity_name: sale_event ? `Venta en ${sale_event}` : 'Venta rápida',
      metadata: {
        ...(sale_total != null ? { total_amount: sale_total } : {}),
        restoreStock,
      },
    })
  }

  return NextResponse.json({ success: true })
}
