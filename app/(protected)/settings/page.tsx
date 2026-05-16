'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Download, Shield, LogOut, ChevronRight,
  Plus, Edit2, Trash2, Eye, EyeOff, Package2,
  X, Check
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { useAllProducts } from '@/hooks/useProducts'
import { usePacks } from '@/hooks/usePacks'
import { formatCurrency } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import type { User, Pack, Product } from '@/types'

type SettingsTab = 'general' | 'users' | 'packs'

export default function SettingsPage() {
  const router = useRouter()
  const { user } = useAppStore()
  const [tab, setTab] = useState<SettingsTab>('general')

  const isAdmin = user?.role === 'admin'

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar title="Configuración" />

      <div className="flex border-b border-zinc-800 shrink-0 overflow-x-auto">
        {(['general', ...(isAdmin ? ['users', 'packs'] : [])] as SettingsTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t ? 'text-white border-b-2 border-white' : 'text-zinc-500'
            }`}
          >
            {t === 'general' ? 'General' : t === 'users' ? 'Usuarios' : 'Packs'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'general' && <GeneralTab user={user} onLogout={handleLogout} />}
        {tab === 'users' && isAdmin && <UsersTab />}
        {tab === 'packs' && isAdmin && <PacksTab />}
      </div>
    </div>
  )
}

function GeneralTab({ user, onLogout }: { user: User | null; onLogout: () => void }) {
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
            <Badge variant={user?.role === 'admin' ? 'warning' : 'info'} className="mt-1">
              {user?.role === 'admin' ? 'Admin' : 'Staff'}
            </Badge>
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
              <span className="text-white">Marshall Flash Merch</span>
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

function UsersTab() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'staff' })
  const [showPassword, setShowPassword] = useState(false)

  const loadUsers = async () => {
    const supabase = createClient()
    const { data } = await supabase.from('profiles').select('*').order('name')
    setUsers(data ?? [])
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase.auth.admin.createUser({
      email: form.email,
      password: form.password,
      email_confirm: true,
      user_metadata: { name: form.name, role: form.role },
    })
    if (!error) {
      setShowModal(false)
      setForm({ email: '', name: '', password: '', role: 'staff' })
      loadUsers()
    }
    setSaving(false)
  }

  const handleToggle = async (user: User) => {
    const supabase = createClient()
    await supabase.from('profiles').update({ active: !user.active }).eq('id', user.id)
    loadUsers()
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => setShowModal(true)} fullWidth variant="outline">
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
              <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                <span className="font-bold text-zinc-400">{u.name?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium text-sm truncate">{u.name}</p>
                <p className="text-zinc-500 text-xs truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={u.role === 'admin' ? 'warning' : 'info'}>
                  {u.role === 'admin' ? 'Admin' : 'Staff'}
                </Badge>
                <button
                  onClick={() => handleToggle(u)}
                  className={`p-1.5 rounded-lg ${u.active ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
                >
                  {u.active ? <Check size={14} /> : <X size={14} />}
                </button>
              </div>
            </div>
          </Card>
        ))
      )}

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
            <div className="grid grid-cols-2 gap-2">
              {['staff', 'admin'].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, role: r }))}
                  className={`py-2.5 px-4 rounded-xl border text-sm font-medium transition-colors ${
                    form.role === r ? 'border-white bg-white/10 text-white' : 'border-zinc-700 text-zinc-400'
                  }`}
                >
                  {r === 'admin' ? 'Admin' : 'Staff'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button type="submit" fullWidth loading={saving}>Crear usuario</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function PacksTab() {
  const { packs, loading, refetch } = usePacks()
  const { products } = useAllProducts()
  const [showModal, setShowModal] = useState(false)
  const [editPack, setEditPack] = useState<Pack | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', sale_price: '' })
  const [packItems, setPackItems] = useState<{ product_id: string; quantity: number }[]>([])

  const openNew = () => {
    setEditPack(null)
    setForm({ name: '', description: '', sale_price: '' })
    setPackItems([])
    setShowModal(true)
  }

  const openEdit = (pack: Pack) => {
    setEditPack(pack)
    setForm({ name: pack.name, description: pack.description ?? '', sale_price: String(pack.sale_price) })
    setPackItems(pack.items?.map(i => ({ product_id: i.product_id, quantity: i.quantity })) ?? [])
    setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    if (editPack) {
      await supabase.from('packs').update({ name: form.name, description: form.description, sale_price: parseFloat(form.sale_price), updated_at: new Date().toISOString() }).eq('id', editPack.id)
      await supabase.from('pack_items').delete().eq('pack_id', editPack.id)
      await supabase.from('pack_items').insert(packItems.map(i => ({ ...i, pack_id: editPack.id })))
    } else {
      const { data: newPack } = await supabase.from('packs').insert({ name: form.name, description: form.description, sale_price: parseFloat(form.sale_price), active: true }).select().single()
      if (newPack) {
        await supabase.from('pack_items').insert(packItems.map(i => ({ ...i, pack_id: newPack.id })))
      }
    }
    setSaving(false)
    setShowModal(false)
    refetch()
  }

  const handleToggle = async (pack: Pack) => {
    const supabase = createClient()
    await supabase.from('packs').update({ active: !pack.active, updated_at: new Date().toISOString() }).eq('id', pack.id)
    refetch()
  }

  const addPackItem = () => {
    if (products.length > 0) {
      setPackItems(prev => [...prev, { product_id: products[0].id, quantity: 1 }])
    }
  }

  const updatePackItem = (idx: number, field: 'product_id' | 'quantity', value: string | number) => {
    setPackItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const removePackItem = (idx: number) => {
    setPackItems(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-3">
      <Button onClick={openNew} fullWidth variant="outline">
        <Plus size={16} />
        Crear pack
      </Button>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      ) : packs.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-zinc-600">
          <Package2 size={32} />
          <p className="mt-2 text-sm">No hay packs creados</p>
        </div>
      ) : (
        packs.map(pack => (
          <Card key={pack.id} padding="md" className={!pack.active ? 'opacity-50' : ''}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                <Package2 size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-bold text-sm">{pack.name}</p>
                <p className="text-white font-bold">{formatCurrency(pack.sale_price)}</p>
                {pack.items && (
                  <p className="text-zinc-500 text-xs mt-1">
                    {pack.items.map(i => `${i.quantity}× ${i.product?.name}`).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(pack)} className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400">
                  <Edit2 size={14} />
                </button>
                <button
                  onClick={() => handleToggle(pack)}
                  className={`p-1.5 rounded-lg ${pack.active ? 'bg-green-900/50 text-green-400' : 'bg-zinc-800 text-zinc-500'}`}
                >
                  {pack.active ? <Check size={14} /> : <X size={14} />}
                </button>
              </div>
            </div>
          </Card>
        ))
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editPack ? 'Editar pack' : 'Nuevo pack'} size="lg">
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Nombre del pack *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Ej: Pack Fan" />
          <Input label="Precio de venta (€) *" type="number" step="0.01" min="0" value={form.sale_price} onChange={e => setForm(f => ({ ...f, sale_price: e.target.value }))} required />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-zinc-300">Productos incluidos</label>
              <button type="button" onClick={addPackItem} className="text-white text-sm flex items-center gap-1">
                <Plus size={14} /> Añadir
              </button>
            </div>
            <div className="space-y-2">
              {packItems.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select
                    value={item.product_id}
                    onChange={e => updatePackItem(idx, 'product_id', e.target.value)}
                    className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl py-2 px-3 text-white text-sm focus:outline-none focus:border-white"
                  >
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={e => updatePackItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                    className="w-14 bg-zinc-800 border border-zinc-700 rounded-xl py-2 px-2 text-white text-sm focus:outline-none focus:border-white text-center"
                  />
                  <button type="button" onClick={() => removePackItem(idx)} className="p-2 text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" fullWidth onClick={() => setShowModal(false)}>Cancelar</Button>
            <Button type="submit" fullWidth loading={saving}>{editPack ? 'Guardar' : 'Crear pack'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
