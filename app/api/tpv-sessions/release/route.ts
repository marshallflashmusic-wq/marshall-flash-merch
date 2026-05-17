import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Libera el bloqueo de dispositivo al cerrar sesión TPV.
// Solo libera si el device_id coincide (el dispositivo que reclama es el propietario).
export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const { sessionId, deviceId } = await request.json()

  if (!sessionId || !deviceId) {
    return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
  }

  const { data: session } = await supabase
    .from('tpv_sessions')
    .select('device_id')
    .eq('id', sessionId)
    .single()

  if (session?.device_id !== deviceId) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  await supabase
    .from('tpv_sessions')
    .update({ device_id: null })
    .eq('id', sessionId)

  return NextResponse.json({ success: true })
}
