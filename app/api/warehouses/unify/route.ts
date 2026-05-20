import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Crea UN único almacén con TODO el stock consolidado.
// Implementado íntegramente en JS para evitar la extensión pg-safeupdate
// de Supabase (que aborta DELETE sin WHERE). Cada DELETE lleva un filtro
// explícito que en la práctica selecciona todas las filas.
export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { name } = body
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Nombre obligatorio' }, { status: 400 })
  }
  const safeName = String(name).trim()

  // 1) Vaciar tablas existentes con filtros que pasan pg-safeupdate.
  //    quantity >= 0 cubre el 100% de las filas; el id != UUID_ZERO también.
  {
    const { error } = await supabase
      .from('warehouse_stock')
      .delete()
      .gte('quantity', 0)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  {
    const { error } = await supabase
      .from('warehouses')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 2) Crear el almacén
  const { data: wh, error: whErr } = await supabase
    .from('warehouses')
    .insert({ name: safeName, sort_order: 0 })
    .select()
    .single()
  if (whErr) return NextResponse.json({ error: whErr.message }, { status: 500 })

  // 3) Cargar productos activos y variantes
  const [prodRes, varRes] = await Promise.all([
    supabase.from('products').select('id, stock').eq('active', true),
    supabase.from('product_variants').select('id, product_id, stock'),
  ])
  if (prodRes.error) return NextResponse.json({ error: prodRes.error.message }, { status: 500 })
  if (varRes.error)  return NextResponse.json({ error: varRes.error.message },  { status: 500 })

  const products = prodRes.data ?? []
  const variants = varRes.data  ?? []

  const variantsByProduct = new Map<string, { id: string; stock: number }[]>()
  for (const v of variants) {
    const list = variantsByProduct.get(v.product_id) ?? []
    list.push({ id: v.id, stock: v.stock })
    variantsByProduct.set(v.product_id, list)
  }

  // 4) Generar filas: producto sin variantes → una fila; con variantes → una por talla
  const rows: { warehouse_id: string; product_id: string; variant_id: string | null; quantity: number }[] = []
  for (const p of products) {
    const vs = variantsByProduct.get(p.id) ?? []
    if (vs.length === 0) {
      if (p.stock > 0) rows.push({ warehouse_id: wh.id, product_id: p.id, variant_id: null, quantity: p.stock })
    } else {
      for (const v of vs) {
        if (v.stock > 0) rows.push({ warehouse_id: wh.id, product_id: p.id, variant_id: v.id, quantity: v.stock })
      }
    }
  }

  let inserted = 0
  let totalUnits = 0
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('warehouse_stock').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    inserted = rows.length
    totalUnits = rows.reduce((a, r) => a + r.quantity, 0)
  }

  return NextResponse.json({
    result: { warehouse_id: wh.id, lines: inserted, units: totalUnits },
  })
}
