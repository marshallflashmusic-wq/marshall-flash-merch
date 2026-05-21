'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Download, LogOut, ChevronRight,
  Plus, Edit2, Trash2, Eye, EyeOff, Package2, Package,
  X, Check, AlertCircle, Terminal, Copy, Clock,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { useAllProducts } from '@/hooks/useProducts'
import { calcAvailableStock } from '@/hooks/usePacks'
import { formatCurrency } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import PackCollage from '@/components/ui/PackCollage'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { User, Pack, PackItem, TpvSession } from '@/types'

type SettingsTab = 'general' | 'users' | 'sessions'

export default function SettingsPage() {
  const router = useRouter()
  const { user, isSaleMode } = useAppStore()
  const [tab, setTab] = useState<SettingsTab>('general')

  // Si no estás en modo venta, eres admin (el nav de TPV no tiene acceso a Settings)
  const isAdmin = !isSaleMode

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const settingsTabs = [
    {
      key: 'general',
      label: 'General',
      content: <div className="px-4 py-4"><GeneralTab user={user} onLogout={handleLogout} isAdmin={isAdmin} /></div>,
    },
    ...(isAdmin ? [
      {
        key: 'users',
        label: 'Usuarios',
        content: <div className="px-4 py-4"><UsersTab currentUser={user} /></div>,
      },
      {
        key: 'sessions',
        label: 'TPV',
        content: <div className="px-4 py-4"><TpvSessionsTab adminId={user?.id ?? null} /></div>,
      },
      ...(user?.role === 'boss' ? [{
        key: 'audit',
        label: 'Auditoría',
        content: <div className="px-4 py-4"><AuditTab /></div>,
      }] : []),
    ] : []),
  ]

  return (
    <div className="h-full flex flex-col">
      <TopBar title="Configuración" />
      <SwipeableTabs
        activeKey={tab}
        onChange={k => setTab(k as SettingsTab)}
        tabs={settingsTabs}
      />
    </div>
  )
}

function GeneralTab({ user, onLogout, isAdmin }: { user: User | null; onLogout: () => void; isAdmin: boolean }) {
  const { products } = useAllProducts()

  const exportInventory = () => {
    const rows = [
      ['SKU', 'Nombre', 'Categoría', 'Precio Compra', 'Precio Venta', 'Stock', 'Stock Mínimo', 'Activo'],
      ...products.map(p => [
        p.sku ?? '',
        p.name,
        p.category?.name ?? '',
        String(p.purchase_price),
        String(p.sale_price),
        String(p.stock),
        String(p.min_stock),
        p.active ? 'Sí' : 'No',
      ]),
    ]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventario-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Perfil */}
      <Card padding="md">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
            <span className="text-white font-black text-lg">
              {user?.name?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <p className="text-white font-bold">{user?.name ?? 'Usuario'}</p>
            <p className="text-zinc-500 text-sm">{user?.email}</p>
            {user?.role === 'boss'
              ? <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase tracking-wide">Boss</span>
              : <Badge variant={isAdmin ? 'warning' : 'info'} className="mt-1">
                  {isAdmin ? 'Admin' : 'Vendedor TPV'}
                </Badge>
            }
          </div>
        </div>
      </Card>

      {/* Exportaciones */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Exportar datos</h2>
        <Card padding="none">
          <button
            onClick={exportInventory}
            className="flex items-center gap-3 w-full px-4 py-3 hover:bg-zinc-800 transition-colors"
          >
            <Download size={18} className="text-zinc-400" />
            <span className="flex-1 text-sm text-white text-left">Exportar inventario CSV</span>
            <ChevronRight size={16} className="text-zinc-600" />
          </button>
        </Card>
      </div>

      {/* Info */}
      <div>
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Acerca de</h2>
        <Card padding="md">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-zinc-500">App</span>
              <span className="text-white">MyMerch</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Versión</span>
              <span className="text-white">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Productos</span>
              <span className="text-white">{products.filter(p => p.active).length} activos</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Logout */}
      <Button variant="danger" fullWidth size="lg" onClick={onLogout}>
        <LogOut size={18} />
        Cerrar sesión
      </Button>
    </div>
  )
}

function UsersTab({ currentUser }: { currentUser: User | null }) {
  const isBoss = currentUser?.role === 'boss'
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'staff' })
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState('')

  const loadUsers = async () => {
    const res = await fetch('/api/users')
    const j = await res.json()
    setUsers(j.users ?? [])
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        actor_id:   currentUser?.id,
        actor_name: currentUser?.name,
        actor_role: currentUser?.role,
      }),
    })
    const j = await res.json()
    if (!res.ok) {
      setFormError(j.error ?? 'Error al crear usuario')
    } else {
      setShowModal(false)
      setForm({ email: '', name: '', password: '', role: 'staff' })
      loadUsers()
    }
    setSaving(false)
  }

  const handleToggle = async (u: User) => {
    await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !u.active }),
    })
    loadUsers()
  }

  const handleDelete = async (u: User) => {
    setDeleting(u.id)
    await fetch(`/api/users/${u.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_id: currentUser?.id, actor_name: currentUser?.name, actor_role: currentUser?.role }),
    })
    setConfirmDelete(null)
    setDeleting(null)
    loadUsers()
  }

  const roleBadge = (role: string) => {
    if (role === 'boss') return <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase tracking-wide">Boss</span>
    if (role === 'admin') return <Badge variant="warning">Admin</Badge>
    return <Badge variant="info">Staff</Badge>
  }

  const availableRoles = isBoss ? ['staff', 'admin', 'boss'] : ['staff', 'admin']
  const roleLabel: Record<string, string> = { staff: 'Staff', admin: 'Admin', boss: 'Boss' }

  return (
    <div className="space-y-3">
      <Button onClick={() => { setFormError(''); setShowModal(true) }} fullWidth variant="outline">
        <Plus size={16} />
        Crear usuario
      </Button>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        users.map(u => (
          <Card key={u.id} padding="md">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${u.role === 'boss' ? 'bg-purple-500/20' : 'bg-zinc-800'}`}>
                <span className={`font-bold text-base ${u.role === 'boss' ? 'text-purple-300' : 'text-zinc-400'}`}>{u.name?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm truncate">{u.name}</p>
                <p className="text-zinc-500 text-xs truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {roleBadge(u.role)}
                <button
                  onClick={() => handleToggle(u)}
                  disabled={u.id === currentUser?.id}
                  className={`p-1.5 rounded-lg transition-colors ${u.active ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-500'} disabled:opacity-30`}
                >
                  {u.active ? <Check size={14} /> : <X size={14} />}
                </button>
                {isBoss && u.id !== currentUser?.id && (
                  <button
                    onClick={() => setConfirmDelete(u)}
                    className="p-1.5 rounded-lg bg-red-900/40 text-red-400 hover:bg-red-900/70 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          </Card>
        ))
      )}

      {/* Modal crear usuario */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuevo usuario" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input label="Nombre *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          <Input label="Email *" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <Input
            label="Contraseña *"
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            required
            suffix={
              <button type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Rol *</label>
            <div className={`grid gap-2 ${availableRoles.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {availableRoles.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: r }))}
                  className={`py-2.5 px-3 rounded-xl border text-sm font-medium transition-colors ${
                    form.role === r
                      ? r === 'boss' ? 'border-purple-400 bg-purple-500/20 text-purple-200' : 'border-white bg-white/10 text-white'
                      : 'border-zinc-700 text-zinc-400'
                  }`}
                >
                  {roleLabel[r]}
                </button>
              ))}
            </div>
          </div>
          {formError && (
            <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-red-400 text-xs">{formError}</p>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button type="submit" fullWidth loading={saving}>Crear usuario</Button>
          </div>
        </form>
      </Modal>

      {/* Modal confirmar eliminación */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar usuario" size="sm">
        <div className="space-y-4">
          <p className="text-zinc-300 text-sm">
            ¿Eliminar a <span className="text-white font-bold">{confirmDelete?.name}</span> ({confirmDelete?.email})?
            Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button
              fullWidth
              loading={deleting === confirmDelete?.id}
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
              className="bg-red-600 hover:bg-red-500 text-white border-red-600"
            >
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Auditoría (solo Boss) ─────────────────────────────────────────────────

type AuditLog = {
  id: string
  action: string
  actor_id: string | null
  actor_name: string
  actor_role: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  metadata: Record<string, unknown>
  created_at: string
}

const ACTION_META: Record<string, { label: string; color: string }> = {
  event_created:  { label: 'Concierto creado',   color: 'text-amber-400'  },
  event_closed:   { label: 'Concierto cerrado',   color: 'text-blue-400'  },
  event_deleted:  { label: 'Concierto eliminado', color: 'text-red-400'   },
  sale_deleted:   { label: 'Venta eliminada',     color: 'text-red-400'   },
  product_created:{ label: 'Artículo creado',     color: 'text-green-400' },
  stock_adjusted: { label: 'Stock ajustado',      color: 'text-cyan-400'  },
  user_created:   { label: 'Usuario creado',      color: 'text-purple-400'},
  user_deleted:   { label: 'Usuario eliminado',   color: 'text-red-400'   },
}

const ACTION_FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'event_created',  label: 'Conciertos' },
  { value: 'event_closed',   label: 'Cierres' },
  { value: 'event_deleted',  label: 'Borrados concierto' },
  { value: 'sale_deleted',   label: 'Ventas eliminadas' },
  { value: 'product_created',label: 'Artículos creados' },
  { value: 'stock_adjusted', label: 'Stock ajustado' },
  { value: 'user_created',   label: 'Usuarios creados' },
  { value: 'user_deleted',   label: 'Usuarios eliminados' },
]

function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [total, setTotal] = useState(0)

  const load = async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (actionFilter) params.set('action', actionFilter)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const res = await fetch(`/api/audit-log?${params.toString()}`)
    const j = await res.json()
    setLogs(j.logs ?? [])
    setTotal(j.total ?? 0)
    setLoading(false)
  }

  useEffect(() => { load() }, [actionFilter, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
      + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  }

  const roleBadgeColor = (role: string) => {
    if (role === 'boss') return 'bg-purple-500/20 text-purple-300 border-purple-500/40'
    if (role === 'admin') return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
  }

  return (
    <div className="space-y-4">
      {/* Filtro de acción */}
      <div className="flex flex-wrap gap-2">
        {ACTION_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setActionFilter(f.value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              actionFilter === f.value
                ? 'border-white bg-white/10 text-white'
                : 'border-zinc-700 text-zinc-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Filtro de fecha */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Desde</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-white"
          />
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 uppercase tracking-wider">Hasta</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-full mt-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-white"
          />
        </div>
      </div>

      {/* Contador */}
      <p className="text-xs text-zinc-500">{total} registro{total !== 1 ? 's' : ''}</p>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-zinc-600">
          <AlertCircle size={32} />
          <p className="mt-2 text-sm">Sin registros</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map(log => {
            const meta = ACTION_META[log.action]
            return (
              <Card key={log.id} padding="md">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-bold ${meta?.color ?? 'text-zinc-400'}`}>
                        {meta?.label ?? log.action}
                      </span>
                      {log.entity_name && (
                        <span className="text-zinc-400 text-xs truncate">— {log.entity_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white text-xs font-medium">{log.actor_name}</span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${roleBadgeColor(log.actor_role)}`}>
                        {log.actor_role}
                      </span>
                    </div>
                    {Object.keys(log.metadata).length > 0 && (
                      <p className="text-zinc-600 text-[10px] leading-relaxed">
                        {Object.entries(log.metadata)
                          .filter(([, v]) => v != null && v !== '')
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <span className="text-zinc-600 text-[10px] shrink-0 whitespace-nowrap">{fmt(log.created_at)}</span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Sesiones TPV ──────────────────────────────────────────────────────────

function formatTimeLeft(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'EXPIRADO'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

function TpvSessionsTab({ adminId }: { adminId: string | null }) {
  const [sessions, setSessions] = useState<TpvSession[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [purging, setPurging] = useState(false)
  const [hours, setHours] = useState(6)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [, forceUpdate] = useState(0)

  const loadSessions = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tpv-sessions')
      if (res.ok) {
        const { sessions: data } = await res.json()
        setSessions(data ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadSessions() }, [])

  // Refrescar el contador de tiempo cada minuto
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  const handleCreate = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/tpv-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, created_by: adminId }),
      })
      if (res.ok) loadSessions()
    } finally {
      setCreating(false)
    }
  }

  const handleInvalidate = async (id: string) => {
    await fetch(`/api/tpv-sessions?id=${id}`, { method: 'DELETE' })
    loadSessions()
  }

  const handlePurgeExpired = async () => {
    setPurging(true)
    await fetch('/api/tpv-sessions?purge_expired=true', { method: 'DELETE' })
    await loadSessions()
    setPurging(false)
  }

  const copyPin = (pin: string, id: string) => {
    navigator.clipboard.writeText(pin).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const active = sessions.filter(s => new Date(s.expires_at) > new Date())
  const expired = sessions.filter(s => new Date(s.expires_at) <= new Date())

  return (
    <div className="space-y-4">
      {/* Generar PIN */}
      <Card padding="md">
        <p className="text-white font-semibold text-sm mb-3">Generar nuevo PIN</p>
        <div className="flex gap-2 mb-3">
          {[2, 4, 6, 12, 24].map(h => (
            <button
              key={h}
              onClick={() => setHours(h)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                hours === h
                  ? 'border-white bg-white/10 text-white'
                  : 'border-zinc-700 text-zinc-500'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
        <Button fullWidth onClick={handleCreate} loading={creating}>
          Generar PIN ({hours}h)
        </Button>
      </Card>

      {/* Lista de sesiones activas */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : active.length === 0 && expired.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-zinc-600">
          <Terminal size={36} />
          <p className="mt-2 text-sm">No hay sesiones activas</p>
          <p className="text-xs mt-1 text-zinc-700">Genera un PIN para que los vendedores puedan entrar</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Activas ({active.length})
              </p>
              <div className="space-y-2">
                {active.map(session => (
                  <Card key={session.id} padding="none">
                    <div className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-black text-xl tracking-[0.2em]">
                            {session.pin_code}
                          </span>
                          <button
                            onClick={() => copyPin(session.pin_code, session.id)}
                            className="p-1 text-zinc-500 hover:text-white transition-colors"
                            title="Copiar PIN"
                          >
                            {copiedId === session.id
                              ? <Check size={13} className="text-green-400" />
                              : <Copy size={13} />
                            }
                          </button>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock size={11} className="text-zinc-600" />
                          <span className="text-zinc-500 text-xs">{formatTimeLeft(session.expires_at)}</span>
                          {session.seller_name && (
                            <span className="text-blue-400 text-xs font-medium">· {session.seller_name}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleInvalidate(session.id)}
                        className="p-2 rounded-xl bg-red-950/50 text-red-500 hover:bg-red-900/50 transition-colors"
                        title="Invalidar"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {expired.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-2">
                Expiradas ({expired.length})
              </p>
              <div className="space-y-2 opacity-50 mb-3">
                {expired.map(session => (
                  <Card key={session.id} padding="none">
                    <div className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-zinc-500 font-black text-lg tracking-[0.2em] line-through">
                          {session.pin_code}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          {session.seller_name && (
                            <span className="text-zinc-600 text-xs">· {session.seller_name}</span>
                          )}
                          <span className="text-zinc-700 text-xs">EXPIRADO</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
              <Button
                variant="outline"
                fullWidth
                loading={purging}
                onClick={handlePurgeExpired}
                className="text-red-400 border-red-900 hover:bg-red-900/20"
              >
                <Trash2 size={15} />
                Borrar PINs caducados ({expired.length})
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface PackItemForm {
  product_id: string
  quantity: number
  individual_pack_price: string
}

function PacksTab() {
  const { products } = useAllProducts()
  const [packs, setPacks] = useState<Pack[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editPack, setEditPack] = useState<Pack | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Pack | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [apiError, setApiError] = useState('')
  const [form, setForm] = useState({ name: '', description: '', sale_price: '' })
  const [packItems, setPackItems] = useState<PackItemForm[]>([])

  const loadPacks = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/packs')
      if (res.ok) {
        const { packs: data } = await res.json()
        setPacks((data ?? []).map((p: Pack) => ({
          ...p,
          available_stock: calcAvailableStock(p.items ?? []),
        })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPacks() }, [])

  // Computed values for modal preview
  const packSalePrice = parseFloat(form.sale_price) || 0
  const normalTotal = packItems.reduce((acc, item) => {
    const p = products.find(x => x.id === item.product_id)
    return acc + (p?.sale_price ?? 0) * item.quantity
  }, 0)
  const savings = normalTotal > 0 ? normalTotal - packSalePrice : 0

  const modalStock = packItems.length > 0
    ? Math.min(...packItems.map(item => {
        const p = products.find(x => x.id === item.product_id)
        return Math.floor((p?.stock ?? 0) / item.quantity)
      }))
    : 0

  const previewItems: PackItem[] = packItems.map(item => ({
    id: '',
    pack_id: '',
    product_id: item.product_id,
    quantity: item.quantity,
    individual_pack_price: item.individual_pack_price ? parseFloat(item.individual_pack_price) : null,
    product: products.find(p => p.id === item.product_id),
  }))

  const openNew = () => {
    setEditPack(null)
    setForm({ name: '', description: '', sale_price: '' })
    setPackItems([])
    setApiError('')
    setShowModal(true)
  }

  const openEdit = (pack: Pack) => {
    setEditPack(pack)
    setForm({
      name: pack.name,
      description: pack.description ?? '',
      sale_price: String(pack.sale_price),
    })
    setPackItems(pack.items?.map(i => ({
      product_id: i.product_id,
      quantity: i.quantity,
      individual_pack_price: i.individual_pack_price != null ? String(i.individual_pack_price) : '',
    })) ?? [])
    setApiError('')
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.sale_price || packItems.length === 0) return
    setSaving(true)
    setApiError('')

    const items = packItems.map(i => ({
      product_id: i.product_id,
      quantity: i.quantity,
      individual_pack_price: i.individual_pack_price ? parseFloat(i.individual_pack_price) : null,
    }))

    try {
      const method = editPack ? 'PATCH' : 'POST'
      const body = editPack
        ? { id: editPack.id, name: form.name.trim(), description: form.description, sale_price: parseFloat(form.sale_price), items }
        : { name: form.name.trim(), description: form.description, sale_price: parseFloat(form.sale_price), items }

      const res = await fetch('/api/packs', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setApiError((data as { error?: string }).error ?? 'Error al guardar el pack')
        return
      }

      setShowModal(false)
      loadPacks()
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (pack: Pack) => {
    await fetch('/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pack.id, active: !pack.active }),
    })
    loadPacks()
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    await fetch(`/api/packs?id=${confirmDelete.id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDelete(null)
    loadPacks()
  }

  const addPackItem = () => {
    if (products.length === 0) return
    setPackItems(prev => [...prev, { product_id: products[0].id, quantity: 1, individual_pack_price: '' }])
  }

  const updatePackItem = (idx: number, field: keyof PackItemForm, value: string | number) => {
    setPackItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const removePackItem = (idx: number) => {
    setPackItems(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      <Button onClick={openNew} fullWidth variant="outline">
        <Plus size={16} />
        Nuevo pack
      </Button>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-zinc-600">
          <Package2 size={36} />
          <p className="mt-2 text-sm">No hay packs configurados</p>
          <p className="text-xs mt-1 text-zinc-700">Crea tu primer pack con el botón de arriba</p>
        </div>
      ) : (
        packs.map(pack => {
          const avail = pack.available_stock ?? 0
          const nTotal = pack.items?.reduce((a, i) => a + (i.product?.sale_price ?? 0) * i.quantity, 0) ?? 0
          const sav = nTotal - pack.sale_price

          return (
            <Card key={pack.id} padding="none" className={!pack.active ? 'opacity-60' : ''}>
              <div className="flex gap-3 p-3">
                {/* Collage */}
                <div className="relative w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-zinc-800">
                  <PackCollage items={pack.items ?? []} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-white font-bold text-sm leading-tight">{pack.name}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(pack)}
                        className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                        title="Editar"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => handleToggle(pack)}
                        className={`p-1.5 rounded-lg transition-colors ${pack.active ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
                        title={pack.active ? 'Desactivar' : 'Activar'}
                      >
                        {pack.active ? <Check size={12} /> : <X size={12} />}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(pack)}
                        className="p-1.5 rounded-lg bg-red-950/60 text-red-500 hover:bg-red-900/60 transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-white font-black text-sm">{formatCurrency(pack.sale_price)}</p>
                    {sav > 0.01 && (
                      <span className="text-green-400 text-xs">ahorra {formatCurrency(sav)}</span>
                    )}
                  </div>

                  {pack.items && pack.items.length > 0 && (
                    <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">
                      {pack.items.map(i => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.product?.name ?? '?'}`).join(' · ')}
                    </p>
                  )}

                  <div className="mt-1">
                    {avail === 0 ? (
                      <span className="text-red-400 text-xs font-bold">AGOTADO</span>
                    ) : (
                      <span className="text-zinc-600 text-xs">{avail} disponible{avail !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          )
        })
      )}

      {/* ── Modal crear / editar pack ─────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editPack ? 'Editar pack' : 'Nuevo pack'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">

          {/* Preview collage */}
          {previewItems.length > 0 && (
            <div className="relative w-full h-28 rounded-2xl overflow-hidden bg-zinc-800">
              <PackCollage items={previewItems} />
            </div>
          )}

          <Input
            label="Nombre del pack *"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            required
            placeholder="Ej: Pack Fan"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Precio de venta (€) *"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={form.sale_price}
              onChange={e => setForm(f => ({ ...f, sale_price: e.target.value }))}
              required
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-zinc-300">Stock disponible</label>
              <div className={`flex items-center h-[46px] px-3 rounded-xl border font-bold text-sm ${
                packItems.length === 0
                  ? 'border-zinc-800 text-zinc-600'
                  : modalStock === 0
                    ? 'border-red-900/60 text-red-400'
                    : 'border-zinc-800 text-white'
              }`}>
                {packItems.length > 0 ? (
                  <span>{modalStock === 0 ? 'AGOTADO' : `${modalStock} uds`}</span>
                ) : '—'}
              </div>
            </div>
          </div>

          {/* Ahorro preview */}
          {packSalePrice > 0 && normalTotal > 0 && (
            <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${
              savings > 0.01 ? 'bg-green-950/50 border border-green-900/60' : 'bg-zinc-800/50'
            }`}>
              <span className="text-zinc-400">Sin pack: <span className="line-through text-zinc-500">{formatCurrency(normalTotal)}</span></span>
              {savings > 0.01
                ? <span className="text-green-400 font-bold">Ahorro: {formatCurrency(savings)}</span>
                : <span className="text-zinc-600">Sin descuento</span>
              }
            </div>
          )}

          {/* Productos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-zinc-300">
                Productos incluidos {packItems.length > 0 && <span className="text-zinc-500 font-normal">({packItems.length})</span>}
              </label>
              <button
                type="button"
                onClick={addPackItem}
                disabled={products.length === 0}
                className="flex items-center gap-1 text-white text-xs px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-40"
              >
                <Plus size={12} /> Añadir
              </button>
            </div>

            {packItems.length === 0 ? (
              <div className="flex items-center gap-2 bg-zinc-800/50 rounded-xl px-3 py-3 text-zinc-600">
                <AlertCircle size={14} />
                <p className="text-xs">Añade al menos un producto al pack</p>
              </div>
            ) : (
              <div className="space-y-2">
                {packItems.map((item, idx) => {
                  const product = products.find(p => p.id === item.product_id)
                  return (
                    <div key={idx} className="bg-zinc-800/60 rounded-xl p-2.5 space-y-2">
                      <div className="flex gap-2 items-center">
                        {/* Thumbnail */}
                        <div className="w-9 h-9 rounded-lg bg-zinc-700 overflow-hidden shrink-0">
                          {product?.image_url ? (
                            <img src={product.image_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package size={13} className="text-zinc-600" />
                            </div>
                          )}
                        </div>

                        <select
                          value={item.product_id}
                          onChange={e => updatePackItem(idx, 'product_id', e.target.value)}
                          className="flex-1 min-w-0 bg-zinc-700 border border-zinc-600 rounded-xl py-2 px-2 text-white text-xs focus:outline-none focus:border-white"
                        >
                          {products.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name} (stock: {p.stock})
                            </option>
                          ))}
                        </select>

                        <div className="flex flex-col items-center gap-0.5 shrink-0">
                          <span className="text-zinc-600 text-[9px] uppercase tracking-wide">Cant.</span>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={e => updatePackItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                            className="w-12 bg-zinc-700 border border-zinc-600 rounded-xl py-1.5 px-1 text-white text-xs focus:outline-none focus:border-white text-center"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => removePackItem(idx)}
                          className="p-1.5 text-red-500 hover:text-red-400 transition-colors shrink-0"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Precio en pack */}
                      <div className="flex items-center gap-2 pl-11">
                        <label className="text-xs text-zinc-500 shrink-0">Precio en pack (€):</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={product ? String(product.sale_price) : '0.00'}
                          value={item.individual_pack_price}
                          onChange={e => updatePackItem(idx, 'individual_pack_price', e.target.value)}
                          className="w-20 bg-zinc-700 border border-zinc-600 rounded-lg py-1 px-2 text-white text-xs focus:outline-none focus:border-white"
                        />
                        {product && (
                          <span className="text-xs text-zinc-600">normal: {formatCurrency(product.sale_price)}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {apiError && (
            <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-red-400 text-sm">{apiError}</p>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              fullWidth
              loading={saving}
              disabled={!form.name.trim() || !form.sale_price || packItems.length === 0}
            >
              {editPack ? 'Guardar cambios' : 'Crear pack'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── Confirmación de borrado ────────────────────────── */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar pack" size="sm">
        <div className="space-y-4">
          <p className="text-zinc-300 text-sm">
            ¿Eliminar el pack <span className="text-white font-bold">"{confirmDelete?.name}"</span>?{' '}
            Esta acción no se puede deshacer. No afecta el stock de los productos.
          </p>
          <div className="flex gap-3">
            <Button variant="outline" fullWidth onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" fullWidth loading={deleting} onClick={handleDelete}>
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
