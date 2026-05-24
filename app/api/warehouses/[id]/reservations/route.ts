import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/warehouses/[id]/reservations
// Devuelve las unidades que han salido de este almacén hacia conciertos
// abiertos (upcoming + active), desglosadas por concierto y artículo.
//
// Una row de event_inventory puede tener stock de varios almacenes mezclado
// en warehouse_allocations ({wh_id, qty}[]). La suma para wh_id = X es lo que
// salió de ese almacén. Para filas sin allocations (datos antiguos), si
// warehouse_id == X tomamos el total asignado.
//
// Cada item viene con assigned (lo que salió) y sold (cuánto se vendió ya).
// pending = assigned - sold = lo que sigue reservado.
type Alloc = { wh_id: string; qty: number }

type EinvRow = {
  id: string
  event_id: string
  product_id: string
  variant_id: string | null
  quantity_assigned: number
  quantity_sold: number
  warehouse_id: string | null
  warehouse_allocations: Alloc[] | null
  event: { id: string; name: string; status: string } | null
  product: { id: string; name: string; image_url: string | null } | null
  variant: { id: string; size: string } | null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id: warehouseId } = await params

  const { data, error } = await supabase
    .from('event_inventory')
    .select(`
      id, event_id, product_id, variant_id,
      quantity_assigned, quantity_sold,
      warehouse_id, warehouse_allocations,
      event:events!inner(id, name, status),
      product:products(id, name, image_url),
      variant:product_variants(id, size)
    `)
    .in('event.status', ['upcoming', 'active'])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Out = {
    event_id: string
    event_name: string
    event_status: string
    product_id: string
    product_name: string
    image_url: string | null
    variant_id: string | null
    size: string | null
    // unidades que salieron de este almacén hacia este evento
    sent: number
    // de esas, cuántas se han vendido ya
    sold: number
  }
  const out: Out[] = []

  for (const r of (data ?? []) as unknown as EinvRow[]) {
    if (!r.event) continue
    const allocs: Alloc[] = Array.isArray(r.warehouse_allocations) ? r.warehouse_allocations : []
    let sentFromThisWh = 0
    if (allocs.length > 0) {
      for (const a of allocs) {
        if (a.wh_id === warehouseId) sentFromThisWh += a.qty
      }
    } else if (r.warehouse_id === warehouseId) {
      sentFromThisWh = r.quantity_assigned ?? 0
    }

    if (sentFromThisWh <= 0) continue

    // Proporción vendida: si todo el assigned salió de varios almacenes,
    // atribuimos sold proporcional a lo que salió de ESTE almacén.
    const totalAssigned = r.quantity_assigned ?? 0
    const sold = r.quantity_sold ?? 0
    const soldFromThisWh = totalAssigned > 0
      ? Math.round((sold * sentFromThisWh) / totalAssigned)
      : 0

    out.push({
      event_id: r.event.id,
      event_name: r.event.name,
      event_status: r.event.status,
      product_id: r.product_id,
      product_name: r.product?.name ?? 'Artículo',
      image_url: r.product?.image_url ?? null,
      variant_id: r.variant_id,
      size: r.variant?.size ?? null,
      sent: sentFromThisWh,
      sold: soldFromThisWh,
    })
  }

  return NextResponse.json({ reservations: out })
}
