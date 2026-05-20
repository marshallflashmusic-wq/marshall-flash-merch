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
    .from('warehouses')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ warehouses: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { name, notes, color } = body
  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Nombre obligatorio' }, { status: 400 })
  }
  const insertData: Record<string, unknown> = {
    name: String(name).trim(),
    notes: notes ? String(notes).trim() : null,
  }
  if (typeof color === 'string' && color) insertData.color = color
  const { data, error } = await supabase
    .from('warehouses')
    .insert(insertData)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ warehouse: data })
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { id, ...patch } = body
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const allowed = ['name', 'notes', 'sort_order', 'color']
  const updateData: Record<string, unknown> = {}
  for (const k of allowed) {
    if (k in patch) updateData[k] = patch[k]
  }
  updateData.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('warehouses')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ warehouse: data })
}

export async function DELETE(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const { error } = await supabase.from('warehouses').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
