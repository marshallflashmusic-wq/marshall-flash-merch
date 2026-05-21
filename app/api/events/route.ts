import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

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
  const { name, city, venue, date, notes, actor_id, actor_name, actor_role } = body

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

  if (actor_name) {
    await logAudit(supabase, {
      action: 'event_created',
      actor_id, actor_name, actor_role: actor_role ?? 'admin',
      entity_type: 'event',
      entity_id: data.id,
      entity_name: data.name,
      metadata: { city: data.city, venue: data.venue, date: data.date },
    })
  }

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

  // Actor info desde el body del DELETE
  let actor_id: string | null = null
  let actor_name: string | null = null
  let actor_role: string = 'admin'
  let eventName: string | null = null
  try {
    const body = await request.json()
    actor_id   = body.actor_id   ?? null
    actor_name = body.actor_name ?? null
    actor_role = body.actor_role ?? 'admin'
    eventName  = body.event_name ?? null
  } catch { /* sin body */ }

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

  if (saleCount > 0 && deleteSales) {
    for (const s of salesRows ?? []) {
      if (restoreStock) {
        const { error: rpcErr } = await supabase.rpc('restore_sale_stock', { p_sale_id: s.id })
        if (rpcErr) {
          console.warn('[DELETE /api/events] restore_sale_stock fallo:', rpcErr.message)
        }
      }
      await supabase.from('sales').delete().eq('id', s.id)
    }
  }

  await supabase.from('event_inventory').delete().eq('event_id', id)
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (actor_name) {
    await logAudit(supabase, {
      action: 'event_deleted',
      actor_id, actor_name, actor_role,
      entity_type: 'event',
      entity_id: id,
      entity_name: eventName,
      metadata: { saleCount, restoreStock, deleteSales },
    })
  }

  return NextResponse.json({ success: true })
}
