import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuditEntry {
  action: string
  actor_id?: string | null
  actor_name: string
  actor_role: string
  entity_type: string
  entity_id?: string | null
  entity_name?: string | null
  metadata?: Record<string, unknown>
}

export async function logAudit(
  supabase: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await supabase.from('audit_log').insert({
    action:      entry.action,
    actor_id:    entry.actor_id   ?? null,
    actor_name:  entry.actor_name,
    actor_role:  entry.actor_role,
    entity_type: entry.entity_type,
    entity_id:   entry.entity_id  ?? null,
    entity_name: entry.entity_name ?? null,
    metadata:    entry.metadata   ?? {},
  })
  if (error) console.error('[audit]', error.message)
}
