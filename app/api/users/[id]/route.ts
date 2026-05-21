import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params

  // Capturar datos del usuario antes de borrarlo
  const { data: profile } = await supabase.from('profiles').select('name, email, role').eq('id', id).maybeSingle()

  let actor_id: string | null = null
  let actor_name: string | null = null
  let actor_role = 'boss'
  try {
    const body = await request.json()
    actor_id   = body.actor_id   ?? null
    actor_name = body.actor_name ?? null
    actor_role = body.actor_role ?? 'boss'
  } catch { /* sin body */ }

  const { error } = await supabase.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('profiles').delete().eq('id', id)

  if (actor_name && profile) {
    await logAudit(supabase, {
      action: 'user_deleted',
      actor_id, actor_name, actor_role,
      entity_type: 'user',
      entity_id: id,
      entity_name: profile.name,
      metadata: { email: profile.email, role: profile.role },
    })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServiceClient()
  const { id } = await params
  const body = await request.json()
  const { active, role } = body

  const updates: Record<string, unknown> = {}
  if (active !== undefined) updates.active = active
  if (role !== undefined) {
    const validRoles = ['staff', 'admin', 'boss']
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
    }
    updates.role = role
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
}
