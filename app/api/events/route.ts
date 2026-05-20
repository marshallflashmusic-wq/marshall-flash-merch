import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

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
  const { name, city, venue, date, notes } = body

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

  // 1) Restaurar stock por cada venta (si así se pidió) y borrar las ventas
  if (saleCount > 0 && deleteSales) {
    for (const s of salesRows ?? []) {
      if (restoreStock) {
        const { error: rpcErr } = await supabase.rpc('restore_sale_stock', { p_sale_id: s.id })
        if (rpcErr) {
          console.warn('[DELETE /api/events] restore_sale_stock fallo:', rpcErr.message)
          // continuamos; preferimos borrar el evento aun si falla la restauración
        }
      }
      await supabase.from('sales').delete().eq('id', s.id)
    }
  }

  // 2) Si se pidió restaurar stock, devolver leftover del inventario asignado al evento
  if (restoreStock) {
    const { data: invRows } = await supabase
      .from('event_inventory')
      .select('id, product_id, variant_id, quantity_assigned, quantity_sold')
      .eq('event_id', id)

    for (const row of invRows ?? []) {
      // Si las ventas se borraron y se restauró stock por restore_sale_stock,
      // entonces quantity_sold ya bajó. Releer la fila para tener el valor actualizado.
      const { data: fresh } = await supabase
        .from('event_inventory')
        .select('quantity_assigned, quantity_sold')
        .eq('id', row.id)
        .single()
      const assigned = fresh?.quantity_assigned ?? row.quantity_assigned
      const sold     = fresh?.quantity_sold     ?? row.quantity_sold
      const leftover = assigned - sold
      if (leftover > 0) {
        const { data: p } = await supabase.from('products').select('stock').eq('id', row.product_id).single()
        if (p) {
          await supabase.from('products').update({ stock: p.stock + leftover, updated_at: new Date().toISOString() }).eq('id', row.product_id)
        }
        if (row.variant_id) {
          const { data: v } = await supabase.from('product_variants').select('stock').eq('id', row.variant_id).single()
          if (v) {
            await supabase.from('product_variants').update({ stock: v.stock + leftover, updated_at: new Date().toISOString() }).eq('id', row.variant_id)
          }
        }
      }
    }
  }

  await supabase.from('event_inventory').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
