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
  const status = searchParams.get('status') // 'pending' | 'resolved' | null=all
  let q = supabase
    .from('help_requests')
    .select('*, event:events(id, name)')
    .order('created_at', { ascending: false })
    .limit(50)
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { seller_name, tpv_session_id, event_id, message } = body
  if (!seller_name) {
    return NextResponse.json({ error: 'seller_name requerido' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('help_requests')
    .insert({
      seller_name: String(seller_name).trim(),
      tpv_session_id: tpv_session_id ?? null,
      event_id: event_id ?? null,
      message: message ? String(message).trim() : null,
      status: 'pending',
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { id, status } = body
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  const next = status === 'resolved' ? 'resolved' : 'pending'
  const { data, error } = await supabase
    .from('help_requests')
    .update({
      status: next,
      resolved_at: next === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ request: data })
}
