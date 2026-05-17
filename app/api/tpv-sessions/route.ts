import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function generatePin(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export async function GET() {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('tpv_sessions')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sessions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { hours = 6, created_by } = body

  // Generar PIN único entre los activos
  let pin = generatePin()
  for (let i = 0; i < 10; i++) {
    const { data: existing } = await supabase
      .from('tpv_sessions')
      .select('id')
      .eq('pin_code', pin)
      .eq('active', true)
      .maybeSingle()
    if (!existing) break
    pin = generatePin()
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('tpv_sessions')
    .insert({ pin_code: pin, expires_at: expiresAt, active: true, created_by: created_by ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ session: data })
}

export async function DELETE(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase
    .from('tpv_sessions')
    .update({ active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
