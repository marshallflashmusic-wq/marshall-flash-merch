'use client'
import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Warehouse, Plus, Edit2, Trash2, Boxes, Package,
  ChevronDown, AlertTriangle, Check, Download, RotateCcw, ArrowRightLeft,
} from 'lucide-react'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import { WAREHOUSE_COLORS, DEFAULT_WH_COLOR } from '@/lib/warehouseColors'

interface Warehouse {
  id: string
  name: string
  notes: string | null
  sort_order: number
  color: string | null
  created_at: string
}


interface Product {
  id: string
  name: string
  image_url: string | null
  stock: number
}

interface Variant {
  id: string
  product_id: string
  size: string
  stock: number
}

interface StockRow {
  warehouse_id: string
  product_id: string
  variant_id: string | null
  quantity: number
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única']

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts]     = useState<Product[]>([])
  const [variants, setVariants]     = useState<Variant[]>([])
  const [stock, setStock]           = useState<StockRow[]>([])
  const [loading, setLoading]       = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createColor, setCreateColor] = useState<string>(DEFAULT_WH_COLOR)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState('')

  const [unifyOpen, setUnifyOpen] = useState(false)
  const [unifyName, setUnifyName] = useState('Almacén principal')
  const [unifying, setUnifying] = useState(false)
  const [unifyErr, setUnifyErr] = useState('')

  const [editWh, setEditWh] = useState<Warehouse | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<string>(DEFAULT_WH_COLOR)

  const [locateRow, setLocateRow] = useState<{
    product_id: string; product_name: string; image_url: string | null;
    variant_id: string | null; size: string | null; unassigned: number;
  } | null>(null)
  const [locateWhId, setLocateWhId] = useState<string>('')
  const [locateQty, setLocateQty] = useState<number>(0)
  const [locating, setLocating] = useState(false)
  const [locateErr, setLocateErr] = useState('')

  const [assignWh, setAssignWh] = useState<Warehouse | null>(null)
  const [viewWh, setViewWh] = useState<Warehouse | null>(null)
  const [fillingId, setFillingId] = useState<string | null>(null)
  const [fillResult, setFillResult] = useState<{ id: string; units: number } | null>(null)
  const [unassignedOpen, setUnassignedOpen] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  // Mover stock entre almacenes
  interface MoveRow {
    from_warehouse_id: string
    from_warehouse_name: string
    product_id: string
    product_name: string
    image_url: string | null
    variant_id: string | null
    size: string | null
    available: number
  }
  const [moveRow, setMoveRow] = useState<MoveRow | null>(null)
  const [moveToWhId, setMoveToWhId] = useState('')
  const [moveQty, setMoveQty] = useState(1)
  const [moving, setMoving] = useState(false)
  const [moveErr, setMoveErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/warehouses/overview', { cache: 'no-store' })
      if (!res.ok) return
      const j = await res.json()
      setWarehouses(j.warehouses ?? [])
      setProducts(j.products ?? [])
      setVariants(j.variants ?? [])
      setStock(j.stock ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Sin ubicar por (product_id, variant_id|null): stock real - lo ubicado en cualquier almacén.
  const unassignedRows = useMemo(() => {
    // Asignado total por clave
    const assignedKey = new Map<string, number>()
    for (const s of stock) {
      const k = `${s.product_id}::${s.variant_id ?? ''}`
      assignedKey.set(k, (assignedKey.get(k) ?? 0) + s.quantity)
    }
    // Filas: una por producto sin variantes; una por variante si tiene
    type Row = { product_id: string; product_name: string; image_url: string | null; variant_id: string | null; size: string | null; unassigned: number; total: number }
    const rows: Row[] = []
    const variantsByProduct = new Map<string, Variant[]>()
    for (const v of variants) {
      const list = variantsByProduct.get(v.product_id) ?? []
      list.push(v); variantsByProduct.set(v.product_id, list)
    }
    for (const p of products) {
      const vs = variantsByProduct.get(p.id) ?? []
      if (vs.length === 0) {
        const k = `${p.id}::`
        const unassigned = p.stock - (assignedKey.get(k) ?? 0)
        if (unassigned > 0) rows.push({
          product_id: p.id, product_name: p.name, image_url: p.image_url,
          variant_id: null, size: null, unassigned, total: p.stock,
        })
      } else {
        for (const v of vs.slice().sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size))) {
          const k = `${p.id}::${v.id}`
          const unassigned = v.stock - (assignedKey.get(k) ?? 0)
          if (unassigned > 0) rows.push({
            product_id: p.id, product_name: p.name, image_url: p.image_url,
            variant_id: v.id, size: v.size, unassigned, total: v.stock,
          })
        }
      }
    }
    return rows
  }, [products, variants, stock])

  const totalGlobal = products.reduce((a, p) => {
    const vs = variants.filter(v => v.product_id === p.id)
    if (vs.length === 0) return a + p.stock
    return a + vs.reduce((s, v) => s + v.stock, 0)
  }, 0)
  const totalUbicado = stock.reduce((a, s) => a + s.quantity, 0)
  const totalSinUbicar = unassignedRows.reduce((a, r) => a + r.unassigned, 0)

  const handleCreate = async () => {
    setCreateErr('')
    if (!createName.trim()) { setCreateErr('Nombre obligatorio'); return }
    setCreating(true)
    try {
      const res = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          notes: createNotes.trim() || undefined,
          color: createColor || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      setCreateName(''); setCreateNotes(''); setCreateColor(DEFAULT_WH_COLOR)
      setCreateOpen(false)
      load()
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setCreating(false)
    }
  }

  const handleUnify = async () => {
    setUnifyErr('')
    if (!unifyName.trim()) { setUnifyErr('Nombre obligatorio'); return }
    setUnifying(true)
    try {
      const res = await fetch('/api/warehouses/unify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: unifyName.trim() }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      setUnifyOpen(false)
      load()
    } catch (e) {
      setUnifyErr(e instanceof Error ? e.message : 'Error')
    } finally {
      setUnifying(false)
    }
  }

  const handleDelete = async (wh: Warehouse) => {
    if (!confirm(`¿Eliminar el almacén "${wh.name}"? El stock que estuviera allí pasará a "Sin ubicar".`)) return
    await fetch(`/api/warehouses?id=${wh.id}`, { method: 'DELETE' })
    load()
  }

  const handleEditSave = async () => {
    if (!editWh || !editName.trim()) return
    await fetch('/api/warehouses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editWh.id, name: editName.trim(), color: editColor }),
    })
    setEditWh(null)
    load()
  }

  const openLocate = (row: {
    product_id: string; product_name: string; image_url: string | null;
    variant_id: string | null; size: string | null; unassigned: number;
  }) => {
    setLocateRow(row)
    setLocateQty(row.unassigned)
    setLocateWhId(warehouses[0]?.id ?? '')
    setLocateErr('')
  }

  const handleLocate = async () => {
    if (!locateRow || !locateWhId || locateQty <= 0) return
    setLocateErr('')
    setLocating(true)
    try {
      // Calcular cantidad final en ese almacén = lo que ya tenga + locateQty
      const current = stock.find(s =>
        s.warehouse_id === locateWhId &&
        s.product_id === locateRow.product_id &&
        (s.variant_id ?? null) === (locateRow.variant_id ?? null)
      )?.quantity ?? 0
      const target = current + locateQty
      const res = await fetch(`/api/warehouses/${locateWhId}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: locateRow.product_id,
          variant_id: locateRow.variant_id ?? null,
          quantity: target,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      setLocateRow(null)
      load()
    } catch (e) {
      setLocateErr(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setLocating(false)
    }
  }

  const handleReconcile = async () => {
    if (!confirm('Esto recorta el stock asignado a almacenes para que cuadre con el stock real. Las unidades que sobraran se descontarán del almacén con más cantidad. ¿Continuar?')) return
    setReconciling(true)
    try {
      const res = await fetch('/api/warehouses/reconcile', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      alert(`Conciliado: ${j.result?.units_removed ?? 0} unidades retiradas.`)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al conciliar')
    } finally {
      setReconciling(false)
    }
  }

  const handleMove = async () => {
    if (!moveRow || !moveToWhId || moveQty <= 0) return
    setMoveErr('')
    setMoving(true)
    try {
      const res = await fetch('/api/warehouses/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_warehouse_id: moveRow.from_warehouse_id,
          to_warehouse_id: moveToWhId,
          product_id: moveRow.product_id,
          variant_id: moveRow.variant_id ?? null,
          quantity: moveQty,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      setMoveRow(null)
      load()
    } catch (e) {
      setMoveErr(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setMoving(false)
    }
  }

  const handleFill = async (wh: Warehouse) => {
    if (totalSinUbicar === 0) return
    if (!confirm(`Añadir las ${totalSinUbicar} unidades sin ubicar a "${wh.name}"?`)) return
    setFillingId(wh.id)
    try {
      const res = await fetch(`/api/warehouses/${wh.id}/fill`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Error')
      setFillResult({ id: wh.id, units: j.result?.units_added ?? 0 })
      setTimeout(() => setFillResult(null), 2500)
      load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Error al añadir stock')
    } finally {
      setFillingId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Almacenes"
        subtitle={`${warehouses.length} almacén${warehouses.length !== 1 ? 'es' : ''}`}
        actions={
          <button onClick={() => setCreateOpen(true)} className="p-2 rounded-xl bg-white text-black">
            <Plus size={18} strokeWidth={2.5} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Resumen global */}
        <Card padding="md">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-zinc-500 text-xs">Stock total</p>
              <p className="text-white font-black text-lg">{totalGlobal}</p>
            </div>
            <div>
              <p className="text-zinc-500 text-xs">Ubicado</p>
              <p className="text-white font-black text-lg">{totalUbicado}</p>
            </div>
            <button
              onClick={() => setUnassignedOpen(true)}
              disabled={totalSinUbicar === 0}
              className={`rounded-lg py-1 -my-1 transition-colors ${
                totalSinUbicar > 0 ? 'hover:bg-amber-500/10 active:bg-amber-500/20' : ''
              }`}
            >
              <p className="text-zinc-500 text-xs">Sin ubicar</p>
              <p className={`font-black text-lg ${totalSinUbicar > 0 ? 'text-amber-400 underline decoration-dotted underline-offset-2' : 'text-zinc-500'}`}>
                {totalSinUbicar}
              </p>
            </button>
          </div>
          {totalSinUbicar > 0 && (
            <button
              onClick={() => setUnassignedOpen(true)}
              className="w-full flex items-start gap-2 mt-3 bg-amber-950/40 hover:bg-amber-950/60 border border-amber-900/60 rounded-xl px-3 py-2 text-left transition-colors"
            >
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-amber-300 text-xs flex-1">
                Hay {totalSinUbicar} unidades sin asignar a ningún almacén. Toca para ver el detalle.
              </p>
              <ChevronDown size={14} className="text-amber-500 shrink-0 mt-0.5 -rotate-90" />
            </button>
          )}
          {totalUbicado > totalGlobal && (
            <div className="mt-3 bg-red-950/40 border border-red-900/60 rounded-xl px-3 py-2 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs flex-1">
                  Hay {totalUbicado - totalGlobal} unidades de más en almacenes que en el stock real (descuadre por ventas antiguas no reflejadas). Pulsa &quot;Conciliar&quot; para recortar el exceso.
                </p>
              </div>
              <Button
                onClick={handleReconcile}
                loading={reconciling}
                variant="outline"
                fullWidth
                className="text-red-400 border-red-900 hover:bg-red-950/30"
              >
                <RotateCcw size={13} />Conciliar ahora
              </Button>
            </div>
          )}
        </Card>

        {/* Acción Almacén único */}
        <Card padding="md">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
              <Boxes size={20} className="text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Almacén único</p>
              <p className="text-zinc-500 text-xs mt-0.5">
                Borra todos los almacenes existentes y crea uno solo con todo el stock. Útil para empezar de cero.
              </p>
              <Button
                onClick={() => { setUnifyName(warehouses[0]?.name ?? 'Almacén principal'); setUnifyOpen(true) }}
                variant="outline"
                className="mt-3 border-amber-700 text-amber-400 hover:bg-amber-950/30"
              >
                <Boxes size={14} />
                Consolidar todo
              </Button>
            </div>
          </div>
        </Card>

        {/* Listado almacenes */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : warehouses.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-zinc-600">
            <Warehouse size={36} />
            <p className="mt-3 text-sm">Sin almacenes creados</p>
            <p className="text-xs mt-1 text-zinc-700">Pulsa + para crear el primero</p>
          </div>
        ) : (
          warehouses.map(wh => {
            const whStock = stock.filter(s => s.warehouse_id === wh.id)
            const units = whStock.reduce((a, s) => a + s.quantity, 0)
            const lines = whStock.length
            return (
              <Card key={wh.id} padding="none">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewWh(wh)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setViewWh(wh) }}
                  className="p-3 flex items-center gap-3 cursor-pointer active:bg-white/5 transition-colors"
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: (wh.color ?? DEFAULT_WH_COLOR) + '33', borderColor: wh.color ?? DEFAULT_WH_COLOR, borderWidth: 1 }}
                  >
                    <Warehouse size={20} style={{ color: wh.color ?? DEFAULT_WH_COLOR }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: wh.color ?? DEFAULT_WH_COLOR }}
                      />
                      <p className="text-white font-bold text-sm truncate">{wh.name}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-zinc-500 text-xs">{units} unidades</span>
                      <span className="text-zinc-700 text-xs">·</span>
                      <span className="text-zinc-500 text-xs">{lines} línea{lines !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setEditWh(wh); setEditName(wh.name); setEditColor(wh.color ?? DEFAULT_WH_COLOR) }}
                      className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(wh)}
                      className="p-2 rounded-lg bg-red-950/40 text-red-400 hover:bg-red-950/70"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="flex border-t border-zinc-800">
                  <button
                    onClick={() => setAssignWh(wh)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-amber-400 hover:bg-amber-500/10 transition-colors"
                  >
                    <Package size={13} />Asignar artículos
                    <ChevronDown size={12} className="-rotate-90" />
                  </button>
                  <button
                    onClick={() => handleFill(wh)}
                    disabled={totalSinUbicar === 0 || fillingId === wh.id}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-l border-zinc-800 transition-colors ${
                      fillResult?.id === wh.id
                        ? 'bg-green-500 text-black'
                        : totalSinUbicar === 0
                          ? 'text-zinc-600 cursor-not-allowed'
                          : 'text-white hover:bg-white/10'
                    } disabled:opacity-60`}
                  >
                    {fillResult?.id === wh.id ? (
                      <><Check size={13} strokeWidth={3} />Añadido {fillResult.units}</>
                    ) : fillingId === wh.id ? (
                      <><div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />Añadiendo…</>
                    ) : (
                      <><Download size={13} />Añadir todo el stock{totalSinUbicar > 0 && ` (${totalSinUbicar})`}</>
                    )}
                  </button>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Modal crear almacén */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nuevo almacén" size="md">
        <div className="space-y-4">
          <Input
            label="Nombre *"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            placeholder="Ej: Local ensayo, Casa Juan, Oficina..."
            autoFocus
          />
          <ColorPicker label="Color" value={createColor} onChange={setCreateColor} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-300">Notas</label>
            <textarea
              value={createNotes}
              onChange={e => setCreateNotes(e.target.value)}
              rows={2}
              placeholder="Dirección, contacto..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white resize-none text-sm"
            />
          </div>
          {createErr && (
            <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-red-400 text-sm">{createErr}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" fullWidth onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button fullWidth loading={creating} onClick={handleCreate}>Crear</Button>
          </div>
        </div>
      </Modal>

      {/* Modal almacén único */}
      <Modal open={unifyOpen} onClose={() => !unifying && setUnifyOpen(false)} title="Almacén único" size="md">
        <div className="space-y-4">
          <div className="bg-amber-950/40 border border-amber-900/60 rounded-xl px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <p className="text-amber-300 text-xs">
              Esto elimina todos los almacenes existentes y consolida todo el stock en uno solo. El stock global de cada artículo no cambia, solo se traslada físicamente.
            </p>
          </div>
          <Input
            label="Nombre del almacén"
            value={unifyName}
            onChange={e => setUnifyName(e.target.value)}
            placeholder="Ej: Almacén principal"
          />
          {unifyErr && (
            <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
              <p className="text-red-400 text-sm">{unifyErr}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" fullWidth onClick={() => setUnifyOpen(false)} disabled={unifying}>Cancelar</Button>
            <Button fullWidth loading={unifying} onClick={handleUnify} className="bg-amber-500 hover:bg-amber-400 text-black">
              <Boxes size={14} />Consolidar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal editar almacén */}
      <Modal open={!!editWh} onClose={() => setEditWh(null)} title="Editar almacén" size="md">
        <div className="space-y-4">
          <Input
            label="Nombre"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            autoFocus
          />
          <ColorPicker label="Color" value={editColor} onChange={setEditColor} />
          <div className="flex gap-2">
            <Button variant="outline" fullWidth onClick={() => setEditWh(null)}>Cancelar</Button>
            <Button fullWidth onClick={handleEditSave}>Guardar</Button>
          </div>
        </div>
      </Modal>

      {/* Modal detalle stock por almacén */}
      <Modal open={!!viewWh} onClose={() => setViewWh(null)} title={viewWh?.name ?? ''} size="md">
        {viewWh && (() => {
          const rows = stock.filter(s => s.warehouse_id === viewWh.id)
          type DetailRow = { product_id: string; product_name: string; image_url: string | null; variant_id: string | null; size: string | null; quantity: number }
          const detail: DetailRow[] = rows.map(s => {
            const p = products.find(pp => pp.id === s.product_id)
            const v = s.variant_id ? variants.find(vv => vv.id === s.variant_id) : null
            return {
              product_id: s.product_id,
              product_name: p?.name ?? 'Artículo',
              image_url: p?.image_url ?? null,
              variant_id: s.variant_id,
              size: v?.size ?? null,
              quantity: s.quantity,
            }
          }).sort((a, b) => {
            if (a.product_name !== b.product_name) return a.product_name.localeCompare(b.product_name)
            return SIZE_ORDER.indexOf(a.size ?? '') - SIZE_ORDER.indexOf(b.size ?? '')
          })
          const totalUnits = detail.reduce((a, r) => a + r.quantity, 0)
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs">Unidades</p>
                  <p className="text-white font-black text-lg">{totalUnits}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
                  <p className="text-zinc-500 text-xs">Líneas</p>
                  <p className="text-white font-black text-lg">{detail.length}</p>
                </div>
              </div>

              {detail.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-zinc-600">
                  <Package size={32} />
                  <p className="mt-2 text-sm">Sin stock en este almacén</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
                  {detail.map((r, idx) => (
                    <div
                      key={`${r.product_id}-${r.variant_id ?? 'none'}-${idx}`}
                      className="flex items-center gap-3 bg-zinc-800/50 border border-zinc-800 rounded-xl p-2.5"
                    >
                      <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                        {r.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.image_url} alt={r.product_name} className="w-full h-full object-cover" />
                        ) : <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-zinc-600" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{r.product_name}</p>
                        {r.size && <p className="text-zinc-500 text-xs mt-0.5">Talla {r.size}</p>}
                      </div>
                      <span
                        className="text-black text-xs font-black px-2 py-1 rounded-lg shrink-0"
                        style={{ backgroundColor: viewWh.color ?? DEFAULT_WH_COLOR }}
                      >
                        {r.quantity} ud
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" fullWidth onClick={() => setViewWh(null)}>Cerrar</Button>
                <Button
                  fullWidth
                  onClick={() => { setAssignWh(viewWh); setViewWh(null) }}
                  className="bg-amber-500 hover:bg-amber-400 text-black"
                >
                  <Package size={14} />Editar stock
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Modal detalle "Sin ubicar" */}
      <Modal open={unassignedOpen} onClose={() => setUnassignedOpen(false)} title={`Sin ubicar (${totalSinUbicar} ud${totalSinUbicar !== 1 ? 's' : ''})`} size="md">
        {unassignedRows.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-zinc-600">
            <Check size={32} className="text-green-500" />
            <p className="mt-2 text-sm">Todo el stock está ubicado</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            <p className="text-zinc-500 text-xs">
              Pulsa un artículo para ubicarlo en uno de tus almacenes.
            </p>
            {warehouses.length === 0 && (
              <p className="text-amber-400 text-xs">Aún no hay almacenes. Crea uno primero.</p>
            )}
            {unassignedRows.map((r, idx) => (
              <button
                key={`${r.product_id}-${r.variant_id ?? 'none'}-${idx}`}
                onClick={() => warehouses.length > 0 && openLocate(r)}
                disabled={warehouses.length === 0}
                className="w-full flex items-center gap-3 bg-zinc-800/50 hover:bg-zinc-800 active:scale-[0.99] border border-zinc-800 rounded-xl p-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                  {r.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.image_url} alt={r.product_name} className="w-full h-full object-cover" />
                  ) : <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-zinc-600" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{r.product_name}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    {r.size ? `Talla ${r.size} · ` : ''}{r.total} ud total
                  </p>
                </div>
                <span className="bg-amber-500 text-black text-xs font-black px-2 py-1 rounded-lg shrink-0">
                  +{r.unassigned}
                </span>
                <ChevronDown size={14} className="text-zinc-500 shrink-0 -rotate-90" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Sub-modal: ubicar artículo concreto en almacén */}
      <Modal open={!!locateRow} onClose={() => !locating && setLocateRow(null)} title="Ubicar en almacén" size="sm">
        {locateRow && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-zinc-800/60 rounded-xl p-2.5">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                {locateRow.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={locateRow.image_url} alt={locateRow.product_name} className="w-full h-full object-cover" />
                ) : <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-zinc-600" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate">{locateRow.product_name}</p>
                <p className="text-zinc-500 text-xs">
                  {locateRow.size ? `Talla ${locateRow.size} · ` : ''}{locateRow.unassigned} ud sin ubicar
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Almacén</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
                {warehouses.map(w => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setLocateWhId(w.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors text-left ${
                      locateWhId === w.id
                        ? 'border-white bg-white/5'
                        : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: w.color ?? DEFAULT_WH_COLOR }}
                    />
                    <span className="text-white text-sm">{w.name}</span>
                    {locateWhId === w.id && <Check size={14} className="ml-auto text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Unidades a ubicar (máx {locateRow.unassigned})</label>
              <input
                type="number"
                min={1}
                max={locateRow.unassigned}
                value={locateQty}
                onChange={e => setLocateQty(Math.max(1, Math.min(locateRow.unassigned, parseInt(e.target.value) || 0)))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>

            {locateErr && (
              <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
                <p className="text-red-400 text-sm">{locateErr}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" fullWidth onClick={() => setLocateRow(null)} disabled={locating}>Cancelar</Button>
              <Button fullWidth onClick={handleLocate} loading={locating} disabled={!locateWhId || locateQty <= 0}>
                <Check size={14} />Ubicar
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal asignar artículos */}
      {assignWh && (
        <AssignStockModal
          warehouse={assignWh}
          products={products}
          variants={variants}
          stock={stock}
          onClose={() => setAssignWh(null)}
          onSaved={() => { load() }}
          onMoveRequest={(row) => {
            setMoveRow(row)
            setMoveToWhId(warehouses.find(w => w.id !== row.from_warehouse_id)?.id ?? '')
            setMoveQty(1)
            setMoveErr('')
          }}
        />
      )}

      {/* Modal mover stock entre almacenes */}
      <Modal open={!!moveRow} onClose={() => !moving && setMoveRow(null)} title="Mover a otro almacén" size="sm">
        {moveRow && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 bg-zinc-800/60 rounded-xl p-2.5">
              <div className="w-10 h-10 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                {moveRow.image_url
                  ? <img src={moveRow.image_url} alt={moveRow.product_name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Package size={16} className="text-zinc-600" /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold truncate">{moveRow.product_name}</p>
                <p className="text-zinc-500 text-xs">
                  {moveRow.size ? `Talla ${moveRow.size} · ` : ''}En {moveRow.from_warehouse_name}: {moveRow.available} ud
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Destino</label>
              <div className="grid grid-cols-1 gap-1.5 max-h-40 overflow-y-auto">
                {warehouses.filter(w => w.id !== moveRow.from_warehouse_id).map(w => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setMoveToWhId(w.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors text-left ${
                      moveToWhId === w.id ? 'border-white bg-white/5' : 'border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: w.color ?? '#71717a' }} />
                    <span className="text-white text-sm">{w.name}</span>
                    {moveToWhId === w.id && <Check size={14} className="ml-auto text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-zinc-400">Unidades a mover (máx {moveRow.available})</label>
              <input
                type="number"
                min={1}
                max={moveRow.available}
                value={moveQty}
                onChange={e => setMoveQty(Math.max(1, Math.min(moveRow.available, parseInt(e.target.value) || 1)))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>

            {moveErr && (
              <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
                <p className="text-red-400 text-sm">{moveErr}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" fullWidth onClick={() => setMoveRow(null)} disabled={moving}>Cancelar</Button>
              <Button fullWidth onClick={handleMove} loading={moving} disabled={!moveToWhId || moveQty <= 0}>
                <ArrowRightLeft size={14} />Mover
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function ColorPicker({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium text-zinc-300">{label}</label>}
      <div className="grid grid-cols-6 gap-2">
        {WAREHOUSE_COLORS.map(c => (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange(c.hex)}
            title={c.name}
            className={`relative h-9 rounded-lg transition-all ${
              value === c.hex ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:opacity-80'
            }`}
            style={{ backgroundColor: c.hex }}
            aria-label={c.name}
          >
            {value === c.hex && (
              <Check size={14} className="absolute inset-0 m-auto text-white" strokeWidth={3} />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

interface MoveRequestRow {
  from_warehouse_id: string
  from_warehouse_name: string
  product_id: string
  product_name: string
  image_url: string | null
  variant_id: string | null
  size: string | null
  available: number
}

function AssignStockModal({ warehouse, products, variants, stock, onClose, onSaved, onMoveRequest }: {
  warehouse: Warehouse
  products: Product[]
  variants: Variant[]
  stock: StockRow[]
  onClose: () => void
  onSaved: () => void
  onMoveRequest: (row: MoveRequestRow) => void
}) {
  // Estado local: cantidad asignada en este almacén por (product_id, variant_id|null)
  const [draft, setDraft] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const s of stock) {
      if (s.warehouse_id !== warehouse.id) continue
      const key = `${s.product_id}::${s.variant_id ?? ''}`
      m[key] = s.quantity
    }
    return m
  })

  // Refresca draft cuando el stock del padre cambia (p.ej. tras mover entre almacenes)
  useEffect(() => {
    const m: Record<string, number> = {}
    for (const s of stock) {
      if (s.warehouse_id !== warehouse.id) continue
      const key = `${s.product_id}::${s.variant_id ?? ''}`
      m[key] = s.quantity
    }
    setDraft(m)
  }, [stock, warehouse.id])
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')
  const [search, setSearch] = useState('')

  // Para mostrar "máximo aquí" hay que conocer la suma en OTROS almacenes
  const otherSumByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of stock) {
      if (s.warehouse_id === warehouse.id) continue
      const key = `${s.product_id}::${s.variant_id ?? ''}`
      m.set(key, (m.get(key) ?? 0) + s.quantity)
    }
    return m
  }, [stock, warehouse.id])

  const variantsByProduct = useMemo(() => {
    const m = new Map<string, Variant[]>()
    for (const v of variants) {
      const list = m.get(v.product_id) ?? []
      list.push(v)
      m.set(v.product_id, list)
    }
    return m
  }, [variants])

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  )

  const setQty = (productId: string, variantId: string | null, value: number) => {
    const key = `${productId}::${variantId ?? ''}`
    setDraft(prev => ({ ...prev, [key]: Math.max(0, value | 0) }))
  }

  const maxFor = (productId: string, variantId: string | null) => {
    const key = `${productId}::${variantId ?? ''}`
    const others = otherSumByKey.get(key) ?? 0
    let available: number
    if (variantId) {
      available = variants.find(v => v.id === variantId)?.stock ?? 0
    } else {
      available = products.find(p => p.id === productId)?.stock ?? 0
    }
    return Math.max(0, available - others)
  }

  const handleSave = async () => {
    setSaveErr('')
    setSaving(true)
    try {
      // Identifica filas que han cambiado
      const initial: Record<string, number> = {}
      for (const s of stock) {
        if (s.warehouse_id !== warehouse.id) continue
        initial[`${s.product_id}::${s.variant_id ?? ''}`] = s.quantity
      }
      const changes: { product_id: string; variant_id: string | null; quantity: number }[] = []
      // draft contiene tanto los que cambiaron como nuevos; mira los actuales
      for (const key of Object.keys(draft)) {
        if ((initial[key] ?? 0) !== draft[key]) {
          const [pid, vid] = key.split('::')
          changes.push({ product_id: pid, variant_id: vid || null, quantity: draft[key] })
        }
      }
      // También los que estaban en initial pero ya no en draft → 0
      for (const key of Object.keys(initial)) {
        if (!(key in draft) && initial[key] > 0) {
          const [pid, vid] = key.split('::')
          changes.push({ product_id: pid, variant_id: vid || null, quantity: 0 })
        }
      }

      for (const ch of changes) {
        const res = await fetch(`/api/warehouses/${warehouse.id}/stock`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ch),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          throw new Error((j as { error?: string }).error ?? 'Error al guardar')
        }
      }
      onSaved()
      onClose()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Error de red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Asignar a ${warehouse.name}`} size="lg">
      <div className="space-y-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar artículo..."
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white text-sm"
        />

        <p className="text-xs text-zinc-500">
          La cantidad asignada no puede superar lo disponible (lo que queda en otros almacenes).
        </p>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {filtered.length === 0 && (
            <p className="text-zinc-600 text-sm text-center py-6">Sin resultados</p>
          )}
          {filtered.map(p => {
            const pVariants = (variantsByProduct.get(p.id) ?? [])
              .slice()
              .sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size))
            const hasVariants = pVariants.length > 0

            return (
              <div key={p.id} className="bg-zinc-800/50 border border-zinc-800 rounded-xl p-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-lg bg-zinc-800 overflow-hidden shrink-0">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                    ) : <div className="w-full h-full flex items-center justify-center"><Package size={14} className="text-zinc-600" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-zinc-500 text-[11px]">Stock total: {p.stock}</p>
                  </div>
                </div>

                {hasVariants ? (
                  <div className="grid grid-cols-3 gap-1.5">
                    {pVariants.map(v => {
                      const key = `${p.id}::${v.id}`
                      const here = draft[key] ?? 0
                      const max = maxFor(p.id, v.id)
                      return (
                        <div key={v.id} className="bg-zinc-900 rounded-lg p-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-300 font-bold">{v.size}</span>
                            <span className="text-zinc-600">/{max}</span>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={max}
                            value={here}
                            onChange={e => setQty(p.id, v.id, parseInt(e.target.value) || 0)}
                            className="w-full bg-zinc-800 border border-zinc-700 rounded-md py-1 px-1.5 text-white text-sm text-center mt-1 focus:outline-none focus:border-white"
                          />
                          {here > 0 && (
                            <button
                              type="button"
                              onClick={() => onMoveRequest({
                                from_warehouse_id: warehouse.id,
                                from_warehouse_name: warehouse.name,
                                product_id: p.id,
                                product_name: p.name,
                                image_url: p.image_url,
                                variant_id: v.id,
                                size: v.size,
                                available: here,
                              })}
                              className="mt-1 w-full flex items-center justify-center gap-0.5 text-[9px] text-zinc-500 hover:text-amber-400 transition-colors"
                            >
                              <ArrowRightLeft size={9} />Mover
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 text-xs">Cantidad aquí:</span>
                    <input
                      type="number"
                      min={0}
                      max={maxFor(p.id, null)}
                      value={draft[`${p.id}::`] ?? 0}
                      onChange={e => setQty(p.id, null, parseInt(e.target.value) || 0)}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md py-1.5 px-2 text-white text-sm focus:outline-none focus:border-white"
                    />
                    <span className="text-zinc-600 text-xs shrink-0">máx {maxFor(p.id, null)}</span>
                    {(draft[`${p.id}::`] ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onMoveRequest({
                          from_warehouse_id: warehouse.id,
                          from_warehouse_name: warehouse.name,
                          product_id: p.id,
                          product_name: p.name,
                          image_url: p.image_url,
                          variant_id: null,
                          size: null,
                          available: draft[`${p.id}::`] ?? 0,
                        })}
                        className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-amber-400 transition-colors shrink-0"
                      >
                        <ArrowRightLeft size={11} />Mover
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {saveErr && (
          <div className="bg-red-950/50 border border-red-900 rounded-xl px-3 py-2">
            <p className="text-red-400 text-sm">{saveErr}</p>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" fullWidth onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button fullWidth onClick={handleSave} loading={saving}>
            <Check size={14} />Guardar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
