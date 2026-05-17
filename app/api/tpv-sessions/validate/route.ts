import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const { pin, sellerName } = await request.json()

  if (!pin || !sellerName?.trim()) {
    return NextResponse.json({ error: 'PIN y nombre son obligatorios' }, { status: 400 })
  }

  const { data: session, error } = await supabase
    .from('tpv_sessions')
    .select('*')
    .eq('pin_code', pin.trim())
    .eq('active', true)
    .maybeSingle()

  if (error || !session) {
    return NextResponse.json({ error: 'PIN no válido o ya no está activo' }, { status: 401 })
  }

  if (new Date(session.expires_at) < new Date()) {
    await supabase.from('tpv_sessions').update({ active: false }).eq('id', session.id)
    return NextResponse.json({ error: 'Este PIN ha expirado' }, { status: 401 })
  }

  await supabase
    .from('tpv_sessions')
    .update({ seller_name: sellerName.trim() })
    .eq('id', session.id)

  return NextResponse.json({
    session: {
      id: session.id,
      sellerName: sellerName.trim(),
      expiresAt: session.expires_at,
    },
  })
}
