'use client'
import { useState, useMemo, useEffect } from 'react'
import {
  Plus, Search, Minus, Edit2, AlertTriangle, Package,
  X, Filter, ChevronDown, Check, Trash2, GripVertical
} from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createClient } from '@/lib/supabase/client'
import { useAllProducts } from '@/hooks/useProducts'
import { useAppStore } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import type { Product } from '@/types'

type FilterStatus = 'all' | 'low_stock' | 'out_of_stock' | 'active' | 'inactive'

export default function InventoryPage() {
  const { user } = useAppStore()
  const { products, loading, refetch } = useAllProducts()
  const [orderedProducts, setOrderedProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [adjustStock, setAdjustStock] = useState<{ product: Product; delta: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [orderError, setOrderError] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  )

  // Sincronizar orden local con los productos del hook, respetando sort_order si existe
  useEffect(() => {
    setOrderedProducts(
      [...products].sort((a, b) => {
        const oa = a.sort_order ?? 0
        const ob = b.sort_order ?? 0
        if (oa !== ob) return oa - ob
        return a.name.localeCompare(b.name)
      })
    )
  }, [products])

  const canReorder = filterStatus === 'all' && search === ''

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedProducts.findIndex(p => p.id === String(active.id))
    const newIndex = orderedProducts.findIndex(p => p.id === String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const prev = orderedProducts
    const next = arrayMove(orderedProducts, oldIndex, newIndex)
    setOrderedProducts(next)
    setOrderError('')

    // Guardar nuevo orden via API (service role, sin RLS)
    fetch('/api/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: next.map((p, idx) => ({ id: p.id, sort_order: idx * 10 })) }),
    })
      .then(r => r.json())
      .then(r => {
        if (r.error) {
          console.error('Error guardando orden:', r.error)
          setOrderedProducts(prev) // revertir si falló
          setOrderError('No se pudo guardar el orden. Ejecuta add-sort-order.sql en Supabase.')
        }
      })
      .catch(e => {
        console.error('Error guardando orden:', e)
        setOrderedProducts(prev)
        setOrderError('Error de red al guardar el orden.')
      })
  }

  useEffect(() => {
    const supabase = createClient()
    supabase.from('categories').select('id, name').order('name').then(({ data }) => {
      if (data && data.length > 0) {
        setCategories(data)
      } else {
        // Fallback hardcoded si RLS bloquea o la tabla está vacía
        setCategories([
          { id: 'cd', name: 'CD' },
          { id: 'textil', name: 'Textil' },
          { id: 'accesorios', name: 'Accesorios' },
        ])
      }
    })
  }, [])

  const filtered = useMemo(() => {
    return orderedProducts.filter(p => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase())
      const matchFilter =
        filterStatus === 'all' ||
        (filterStatus === 'low_stock' && p.stock > 0 && p.stock < 3) ||
        (filterStatus === 'out_of_stock' && p.stock === 0) ||
        (filterStatus === 'active' && p.active) ||
        (filterStatus === 'inactive' && !p.active)
      return matchSearch && matchFilter
    })
  }, [orderedProducts, search, filterStatus])

  const handleQuickStock = async (product: Product, delta: number) => {
    const supabase = createClient()
    const newStock = Math.max(0, product.stock + delta)
    await supabase
      .from('products')
      .update({ stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', product.id)
    await supabase.from('inventory_movements').insert({
      product_id: product.id,
      type: delta > 0 ? 'restock' : 'adjustment',
      quantity: Math.abs(delta),
      previous_stock: product.stock,
      new_stock: newStock,
      user_id: user?.id,
      notes: 'Ajuste manual',
    })
    refetch()
  }

  const handleSaveProduct = async (data: Partial<Product>, imageFile: File | null): Promise<string | null> => {
    setSaving(true)
    try {
      const supabase = createClient()

      // Subir imagen si se seleccionó un fichero
      let imageUrl = data.image_url
      if (imageFile) {
        const ext = imageFile.name.split('.').pop()
        const fileName = `${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('product-images')
          .upload(fileName, imageFile, { upsert: true })
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(fileName)
          imageUrl = urlData.publicUrl
        }
      }

      const payload = Object.fromEntries(
        Object.entries({ ...data, image_url: imageUrl })
          .filter(([, v]) => v !== undefined)
      )

      if (editProduct?.id) {
        const { error } = await supabase
          .from('products')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editProduct.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('products')
          .insert({ ...payload, active: true })
        if (error) throw error
      }
      setEditProduct(null)
      setShowAddModal(false)
      refetch()
      return null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al guardar'
      return msg.includes('policy') || msg.includes('permission')
        ? 'Sin permisos. Ejecuta supabase/fix-admin.sql en el SQL Editor de Supabase.'
        : msg
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (product: Product) => {
    const supabase = createClient()
    await supabase.from('products').update({ active: !product.active, updated_at: new Date().toISOString() }).eq('id', product.id)
    refetch()
  }

  const lowStockCount = orderedProducts.filter(p => p.stock > 0 && p.stock < 3 && p.active).length
  const outOfStockCount = orderedProducts.filter(p => p.stock === 0 && p.active).length

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Inventario"
        subtitle={`${orderedProducts.length} productos`}
        actions={
          <button
            onClick={() => { setEditProduct(null); setShowAddModal(true) }}
            className="p-2 rounded-xl bg-white text-black"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Alerts */}
        {(lowStockCount > 0 || outOfStockCount > 0 || orderError) && (
          <div className="px-4 pt-4 space-y-2">
            {orderError && (
              <div className="flex items-center gap-2 bg-amber-950/50 border border-amber-900 rounded-xl px-3 py-2">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <p className="text-amber-400 text-sm">{orderError}</p>
              </div>
            )}
            {outOfStockCount > 0 && (
              <div className="flex items-center gap-2 bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
                <X size={16} className="text-red-500 shrink-0" />
                <p className="text-red-400 text-sm">{outOfStockCount} producto{outOfStockCount !== 1 ? 's' : ''} sin stock</p>
              </div>
            )}
            {lowStockCount > 0 && (
              <div className="flex items-center gap-2 bg-amber-950/50 border border-amber-900 rounded-xl px-3 py-2">
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <p className="text-amber-400 text-sm">{lowStockCount} producto{lowStockCount !== 1 ? 's' : ''} con stock bajo</p>
              </div>
            )}
          </div>
        )}

        {/* Search & Filters */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar producto..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-2.5 pl-9 pr-4 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500">
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {(['all', 'low_stock', 'out_of_stock', 'active', 'inactive'] as FilterStatus[]).map(f => (
              <button
                key={f}
                onClick={() => setFilterStatus(f)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filterStatus === f ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {f === 'all' ? 'Todos' : f === 'low_stock' ? 'Stock bajo' : f === 'out_of_stock' ? 'Sin stock' : f === 'active' ? 'Activos' : 'Inactivos'}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Package size={40} />
            <p className="mt-3 text-sm">No hay productos</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filtered.map(p => p.id)} strategy={verticalListSortingStrategy}>
              <div className="px-4 pb-4 space-y-2">
                {canReorder && (
                  <p className="text-xs text-zinc-600 text-center pb-1">Mantén pulsado y arrastra para reordenar</p>
                )}
                {filtered.map(product => (
                  <SortableProductCard
                    key={product.id}
                    product={product}
                    canReorder={canReorder}
                    onEdit={() => setEditProduct(product)}
                    onToggleActive={() => handleToggleActive(product)}
                    onStockDown={() => handleQuickStock(product, -1)}
                    onStockUp={() => handleQuickStock(product, 1)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Product Edit/Add Modal */}
      <ProductModal
        open={showAddModal || !!editProduct}
        product={editProduct}
        categories={categories}
        onClose={() => { setEditProduct(null); setShowAddModal(false) }}
        onSave={handleSaveProduct}
        saving={saving}
      />
    </div>
  )
}

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']

function ProductModal({ open, product, categories, onClose, onSave, saving }: {
  open: boolean
  product: Product | null
  categories: { id: string; name: string }[]
  onClose: () => void
  onSave: (data: Partial<Product>, imageFile: File | null) => Promise<string | null>
  saving: boolean
}) {
  const [form, setForm] = useState({
    name: '',
    category_id: '',
    size: '',
    sku: '',
    purchase_price: '',
    sale_price: '',
    stock: '0',
    min_stock: '2',
    image_url: '',
  })
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useMemo(() => {
    setError('')
    setFieldErrors({})
    setImageFile(null)
    setImagePreview('')
    if (product) {
      setForm({
        name: product.name,
        category_id: product.category_id ?? '',
        size: product.size ?? '',
        sku: product.sku ?? '',
        purchase_price: String(product.purchase_price),
        sale_price: String(product.sale_price),
        stock: String(product.stock),
        min_stock: String(product.min_stock),
        image_url: product.image_url ?? '',
      })
      if (product.image_url) setImagePreview(product.image_url)
    } else {
      setForm({ name: '', category_id: '', size: '', sku: '', purchase_price: '', sale_price: '', stock: '0', min_stock: '2', image_url: '' })
    }
  }, [product, open])

  const selectedCategory = categories.find(c => c.id === form.category_id)
  const isTextile = selectedCategory?.name === 'Textil'

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const validate = () => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'El nombre es obligatorio'
    if (!form.sale_price || parseFloat(form.sale_price) < 0) errs.sale_price = 'Introduce el PVP'
    if (form.stock === '' || parseInt(form.stock) < 0) errs.stock = 'Introduce la cantidad'
    return errs
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const errs = validate()
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return }
    setFieldErrors({})
    const err = await onSave({
      name: form.name.trim(),
      category_id: form.category_id || undefined,
      size: isTextile && form.size ? form.size : undefined,
      sku: form.sku.trim() || undefined,
      purchase_price: parseFloat(form.purchase_price) || 0,
      sale_price: parseFloat(form.sale_price),
      stock: parseInt(form.stock),
      min_stock: parseInt(form.min_stock) || 2,
      image_url: form.image_url || undefined,
    }, imageFile)
    if (err) setError(err)
  }

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Editar artículo' : 'Nuevo artículo'} size="md">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>

        {/* Imagen */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-300">Imagen</label>
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl bg-zinc-800 border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center">
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <Package size={24} className="text-zinc-600" />
              )}
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <label className="cursor-pointer">
                <span className="block w-full text-center py-2 px-3 rounded-xl border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 hover:text-zinc-300 transition-colors">
                  Subir foto
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </label>
              <Input
                placeholder="O pega una URL de imagen"
                value={form.image_url}
                onChange={e => { setForm(f => ({ ...f, image_url: e.target.value })); setImagePreview(e.target.value) }}
              />
            </div>
          </div>
        </div>

        {/* Nombre */}
        <Input
          label="Nombre *"
          value={form.name}
          onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setFieldErrors(fe => ({ ...fe, name: '' })) }}
          placeholder="Ej: Camiseta Marshall Flash"
          error={fieldErrors.name}
        />

        {/* Categoría */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-300">Categoría</label>
          <select
            value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value, size: '' }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-white text-sm"
          >
            <option value="">Sin categoría</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Talla — solo si es Ropa */}
        {isTextile && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Talla</label>
            <div className="flex flex-wrap gap-2">
              {SIZES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, size: f.size === s ? '' : s }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    form.size === s
                      ? 'bg-white border-white text-black'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Precios */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Precio compra (€)"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.purchase_price}
            onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
          />
          <Input
            label="PVP — Precio venta (€) *"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={form.sale_price}
            onChange={e => { setForm(f => ({ ...f, sale_price: e.target.value })); setFieldErrors(fe => ({ ...fe, sale_price: '' })) }}
            error={fieldErrors.sale_price}
          />
        </div>

        {/* Stock */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Cantidad *"
            type="number"
            min="0"
            placeholder="0"
            value={form.stock}
            onChange={e => { setForm(f => ({ ...f, stock: e.target.value })); setFieldErrors(fe => ({ ...fe, stock: '' })) }}
            error={fieldErrors.stock}
          />
          <Input
            label="Stock mínimo"
            type="number"
            min="0"
            placeholder="2"
            value={form.min_stock}
            onChange={e => setForm(f => ({ ...f, min_stock: e.target.value }))}
          />
        </div>

        {/* SKU */}
        <Input
          label="SKU / Referencia"
          value={form.sku}
          onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
          placeholder="Código interno (opcional)"
        />

        {error && (
          <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2.5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        <div className="flex gap-3 pt-1">
          <Button type="button" variant="outline" fullWidth onClick={onClose}>Cancelar</Button>
          <Button type="submit" fullWidth loading={saving}>{product ? 'Guardar' : 'Crear artículo'}</Button>
        </div>
      </form>
    </Modal>
  )
}

function SortableProductCard({ product, canReorder, onEdit, onToggleActive, onStockDown, onStockUp }: {
  product: Product
  canReorder: boolean
  onEdit: () => void
  onToggleActive: () => void
  onStockDown: () => void
  onStockUp: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: product.id })
  const isLowStock = product.stock > 0 && product.stock < 3
  const isOutOfStock = product.stock === 0

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      <Card padding="none" className={`overflow-hidden ${!product.active ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-3 p-3">
          {/* Drag handle */}
          {canReorder && (
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="shrink-0 p-1 text-zinc-700 hover:text-zinc-400 touch-none cursor-grab active:cursor-grabbing"
              aria-label="Arrastrar para reordenar"
            >
              <GripVertical size={18} />
            </button>
          )}

          {/* Image */}
          <div className="w-14 h-14 rounded-xl bg-zinc-800 overflow-hidden shrink-0">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package size={20} className="text-zinc-600" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-white text-sm truncate">{product.name}</p>
              {isOutOfStock && <Badge variant="danger">Sin stock</Badge>}
              {isLowStock && <Badge variant="warning">Stock bajo</Badge>}
            </div>
            {product.sku && <p className="text-xs text-zinc-600 mt-0.5">{product.sku}</p>}
            <p className="text-white font-bold text-sm mt-0.5">{formatCurrency(product.sale_price)}</p>
          </div>

          {/* Stock control */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onStockDown}
              disabled={product.stock === 0}
              className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
            >
              <Minus size={14} />
            </button>
            <span className={`w-8 text-center font-bold text-sm ${isOutOfStock ? 'text-red-400' : isLowStock ? 'text-amber-400' : 'text-white'}`}>
              {product.stock}
            </span>
            <button
              onClick={onStockUp}
              className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center active:scale-95 transition-transform"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex border-t border-zinc-800">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-zinc-500 active:bg-zinc-800 transition-colors"
          >
            <Edit2 size={12} />
            Editar
          </button>
          <button
            onClick={onToggleActive}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-zinc-500 active:bg-zinc-800 transition-colors border-l border-zinc-800"
          >
            {product.active ? <X size={12} /> : <Check size={12} />}
            {product.active ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </Card>
    </div>
  )
}
