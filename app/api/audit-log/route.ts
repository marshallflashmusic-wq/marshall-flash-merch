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

  let q = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  const action    = searchParams.get('action')
  const actor_id  = searchParams.get('actor_id')
  const date_from = searchParams.get('date_from')
  const date_to   = searchParams.get('date_to')

  if (action)    q = q.eq('action', action)
  if (actor_id)  q = q.eq('actor_id', actor_id)
  if (date_from) q = q.gte('created_at', date_from)
  if (date_to)   q = q.lte('created_at', date_to + 'T23:59:59')

  const { data, count, error } = await q.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data ?? [], total: count ?? 0 })
}
