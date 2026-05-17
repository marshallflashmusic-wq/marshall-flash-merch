import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// El dispositivo TPV llama a este endpoint cada 15s para verificar que su sesión sigue activa.
// Si el admin la ha revocado o ha expirado, devuelve { valid: false }.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ valid: false })

  const supabase = getServiceClient()
  const { data: session } = await supabase
    .from('tpv_sessions')
    .select('active, expires_at')
    .eq('id', id)
    .single()

  if (!session || !session.active || new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ valid: false })
  }

  return NextResponse.json({ valid: true })
}
