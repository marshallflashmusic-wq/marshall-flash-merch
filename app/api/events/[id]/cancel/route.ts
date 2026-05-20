import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  const { data, error } = await supabase.rpc('cancel_event', { p_event_id: id })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('EVENTO_YA_CERRADO') || msg.includes('EVENTO_YA_CANCELADO')) {
      return NextResponse.json({ error: 'El concierto ya está cerrado o cancelado.' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ result: data })
}
