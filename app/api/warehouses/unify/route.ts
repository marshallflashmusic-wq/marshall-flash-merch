import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Crea (o reemplaza) UN único almacén con todo el stock consolidado.
// Usa la función SQL unify_warehouse, que primero borra cualquier almacén
// existente y luego inserta una fila warehouse_stock por producto/variante
// con quantity = stock actual.
export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { name } = body
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Nombre obligatorio' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('unify_warehouse', { p_name: String(name).trim() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ result: data })
}
