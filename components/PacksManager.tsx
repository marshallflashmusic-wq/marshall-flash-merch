'use client'
import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import {
  Plus, Edit2, Trash2, Check, X, Package, Package2, AlertCircle,
} from 'lucide-react'
import { calcAvailableStock } from '@/hooks/usePacks'
import { formatCurrency } from '@/lib/utils'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import PackCollage from '@/components/ui/PackCollage'
import type { Pack, PackItem, Product } from '@/types'

export interface PacksManagerRef {
  openNew: () => void
}

interface PackItemForm {
  product_id: string
  quantity: number
  individual_pack_price: string
}

interface Props {
  products: Product[]
}

const PacksManager = forwardRef<PacksManagerRef, Props>(({ products }, ref) => {
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

  // ── Computed values for modal preview ──
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

  // ── Open / close modal ──
  const openNew = () => {
    setEditPack(null)
    setForm({ name: '', description: '', sale_price: '' })
    setPackItems([])
    setApiError('')
    setShowModal(true)
  }

  useImperativeHandle(ref, () => ({ openNew }))

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

  // ── Save ──
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

  // ── Toggle active ──
  const handleToggle = async (pack: Pack) => {
    await fetch('/api/packs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pack.id, active: !pack.active }),
    })
    loadPacks()
  }

  // ── Delete ──
  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    await fetch(`/api/packs?id=${confirmDelete.id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDelete(null)
    loadPacks()
  }

  // ── Pack items helpers ──
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

  // ── Render ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {packs.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-zinc-600">
          <Package2 size={40} />
          <p className="mt-3 text-sm">No hay packs creados</p>
          <p className="text-xs mt-1 text-zinc-700">Pulsa + para crear tu primer pack</p>
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
                      {pack.items.map(i =>
                        `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.product?.name ?? '?'}`
                      ).join(' · ')}
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

      {/* ── Modal crear / editar ── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editPack ? 'Editar pack' : 'Nuevo pack'}
        size="lg"
      >
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
                {packItems.length > 0 ? (modalStock === 0 ? 'AGOTADO' : `${modalStock} uds`) : '—'}
              </div>
            </div>
          </div>

          {/* Ahorro preview */}
          {packSalePrice > 0 && normalTotal > 0 && (
            <div className={`flex items-center justify-between rounded-xl px-3 py-2 text-xs ${
              savings > 0.01 ? 'bg-green-950/50 border border-green-900/60' : 'bg-zinc-800/50'
            }`}>
              <span className="text-zinc-400">
                Sin pack: <span className="line-through text-zinc-500">{formatCurrency(normalTotal)}</span>
              </span>
              {savings > 0.01
                ? <span className="text-green-400 font-bold">Ahorro: {formatCurrency(savings)}</span>
                : <span className="text-zinc-600">Sin descuento</span>
              }
            </div>
          )}

          {/* Productos incluidos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-zinc-300">
                Productos incluidos{packItems.length > 0 && <span className="text-zinc-500 font-normal"> ({packItems.length})</span>}
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

      {/* ── Confirmación borrado ── */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar pack" size="sm">
        <div className="space-y-4">
          <p className="text-zinc-300 text-sm">
            ¿Eliminar el pack <span className="text-white font-bold">"{confirmDelete?.name}"</span>?{' '}
            No afecta el stock de los productos individuales.
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
})

PacksManager.displayName = 'PacksManager'
export default PacksManager
