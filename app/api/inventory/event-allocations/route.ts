import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Devuelve las asignaciones de event_inventory para eventos NO cerrados/cancelados.
// El stock asignado a esos eventos sigue "reservado" fuera del global, así que
// el admin necesita verlo desde la pantalla de Stock global.
//
// Formato:
//   [{
//     event_id, event_name, event_city, event_status,
//     product_id, variant_id, variant_size,
//     quantity_assigned, quantity_sold, quantity_remaining
//   }]
export async function GET() {
  const supabase = getServiceClient()

  // Cargamos en 3 queries simples (más resiliente que la embedded select)
  const [invRes, eventsRes, variantsRes] = await Promise.all([
    supabase
      .from('event_inventory')
      .select('id, event_id, product_id, variant_id, quantity_assigned, quantity_sold')
      .gt('quantity_assigned', 0),
    supabase
      .from('events')
      .select('id, name, city, status'),
    supabase
      .from('product_variants')
      .select('id, size'),
  ])

  if (invRes.error) {
    console.error('[event-allocations] event_inventory error:', invRes.error.message)
    return NextResponse.json({ error: invRes.error.message }, { status: 500 })
  }

  const eventsById = new Map<string, { name: string; city: string; status: string }>()
  for (const e of eventsRes.data ?? []) eventsById.set(e.id, { name: e.name, city: e.city, status: e.status })

  const variantsById = new Map<string, string>()
  for (const v of variantsRes.data ?? []) variantsById.set(v.id, v.size)

  const flat = (invRes.data ?? [])
    .map(r => {
      const ev = eventsById.get(r.event_id)
      if (!ev) return null
      if (ev.status === 'closed' || ev.status === 'cancelled') return null
      return {
        id: r.id,
        event_id: r.event_id,
        event_name: ev.name,
        event_city: ev.city,
        event_status: ev.status,
        product_id: r.product_id,
        variant_id: r.variant_id,
        variant_size: r.variant_id ? (variantsById.get(r.variant_id) ?? null) : null,
        quantity_assigned: r.quantity_assigned,
        quantity_sold: r.quantity_sold,
        quantity_remaining: r.quantity_assigned - r.quantity_sold,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return NextResponse.json({ allocations: flat })
}
