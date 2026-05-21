import { createClient as createServerClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

function getServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  // Verificar sesión con el cliente normal (anon key)
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session?.user || session.user.is_anonymous) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id
  const email = session.user.email ?? ''

  // Leer perfil con service role (sin restricciones de RLS)
  const service = getServiceClient()
  const { data, error } = await service
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (data) {
    return NextResponse.json({ profile: data })
  }

  // Perfil no existe → crearlo
  const name = email.split('@')[0]
  const { data: created, error: createError } = await service
    .from('profiles')
    .upsert({ id: userId, email, name, role: 'admin', active: true })
    .select('*')
    .single()

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  return NextResponse.json({ profile: created })
}
