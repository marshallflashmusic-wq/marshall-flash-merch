'use client'
import { useState, useEffect, useMemo } from 'react'
import { Clock, Filter, Banknote, Smartphone, CreditCard, Wallet, Download, X, Trash2, MessageSquare, Pencil, Package2, CalendarDays, Zap, Warehouse, Globe } from 'lucide-react'
import { useSalesHistory } from '@/hooks/useSales'
import { useEvents } from '@/hooks/useEvents'
import { useAppStore } from '@/store/appStore'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SwipeableTabs from '@/components/ui/SwipeableTabs'
import type { Sale, PaymentMethod, SaleFilters, SaleChannel } from '@/types'

type ScopeTab = 'all' | 'events' | 'quick' | 'web'

const paymentIcons: Record<PaymentMethod, React.ElementType> = {
  efectivo: Banknote,
  bizum: Smartphone,
  tarjeta: CreditCard,
  paypal: Wallet,
  mixto: Wallet,
}

const paymentColors: Record<PaymentMethod, string> = {
  efectivo: 'text-green-400',
  bizum: 'text-blue-400',
  tarjeta: 'text-purple-400',
  paypal: 'text-sky-400',
  mixto: 'text-zinc-400',
}

const paymentLabels: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  bizum: 'Bizum',
  tarjeta: 'Tarjeta',
  paypal: 'PayPal',
  mixto: 'Mixto',
}

export default function SalesHistoryPage() {
  const { events } = useEvents()
  const [filters, setFilters] = useState<SaleFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [editingSale, setEditingSale] = useState<Sale | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  type DeleteItemPlan = { sale_item_id: string; product_id: string; product_name: string; quantity: number; include: boolean }
  type RestoreMode = 'origin' | 'custom' | 'none'
  const [deleteConfirm, setDeleteConfirm] = useState<{ sale: Sale; mode: RestoreMode; warehouseId: string; itemPlans: DeleteItemPlan[] } | null>(null)
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [editAmount, setEditAmount] = useState('')
  const [editPayment, setEditPayment] = useState<PaymentMethod>('efectivo')
  const [editNotes, setEditNotes] = useState('')
  const [editError, setEditError] = useState('')
  const { isSaleMode, activeEvent, user } = useAppStore()
  // En modo TPV el invitado solo puede ver ventas del evento activo.
  // Forzamos el filtro de evento en la consulta para que ni siquiera se
  // transmitan al cliente las ventas globales/rápidas.
  const effectiveFilters = useMemo<SaleFilters>(() => (
    isSaleMode && activeEvent?.id
      ? { ...filters, event_id: activeEvent.id }
      : filters
  ), [filters, isSaleMode, activeEvent?.id])
  const skipFetch = isSaleMode && !activeEvent
  const { sales: rawSales, loading, total: rawTotal, refetch } = useSalesHistory(effectiveFilters)
  // Si el TPV no tiene evento activo, vaciamos para no exponer ventas globales.
  const sales = skipFetch ? [] : rawSales
  const total = skipFetch ? 0 : rawTotal
  const [scope, setScope] = useState<ScopeTab>('all')

  // Ventas presenciales (POS): rápidas + de concierto. Las web se desglosan aparte.
  const presencialSales = useMemo(() => sales.filter(s => s.sale_channel !== 'web'), [sales])
  const webSales = useMemo(() => sales.filter(s => s.sale_channel === 'web'), [sales])
  const eventCount = useMemo(() => presencialSales.filter(s => !!s.event_id).length, [presencialSales])
  const quickCount = useMemo(() => presencialSales.filter(s => !s.event_id).length, [presencialSales])
  const webCount = useMemo(() => webSales.length, [webSales])

  // Auto-refresco cada 10s + al volver a la pestaña
  useEffect(() => {
    const interval = setInterval(refetch, 10_000)
    const handleVisibility = () => { if (document.visibilityState === 'visible') refetch() }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refetch])

  // Cargamos los almacenes en cuanto entra el admin: necesarios tanto para el
  // detalle (mostrar nombre del almacén único) como para el modal de eliminar.
  useEffect(() => {
    if (isSaleMode) return
    fetch('/api/warehouses', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => setWarehouses(j.warehouses ?? []))
      .catch(() => {})
  }, [isSaleMode])

  const handleDelete = (sale: Sale) => {
    setSelectedSale(null)
    const itemPlans: DeleteItemPlan[] = (sale.items ?? [])
      .filter(i => !!i.product_id)
      .map(i => ({
        sale_item_id: i.id,
        product_id: i.product_id!,
        product_name: i.product?.name ?? 'Artículo',
        quantity: i.quantity,
        include: true,
      }))
    setDeleteConfirm({ sale, mode: 'origin', warehouseId: '', itemPlans })
    if (warehouses.length === 0) {
      fetch('/api/warehouses/overview', { cache: 'no-store' })
        .then(r => r.json())
        .then(j => setWarehouses(j.warehouses ?? []))
        .catch(() => {})
    }
  }

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    const { sale, mode, warehouseId, itemPlans } = deleteConfirm
    setDeleteConfirm(null)
    setDeleteError('')
    setDeletingId(sale.id)
    try {
      // mode='origin' → no enviamos restorations: el servidor usa sale_items.warehouse_id
      // mode='custom' → enviamos restorations dirigidas a un único almacén
      // mode='none'   → no restauramos stock (restoreStock=false)
      const restoreStock = mode !== 'none'
      const restorations = mode === 'custom' && warehouseId
        ? itemPlans
            .filter(p => p.include)
            .map(p => ({ product_id: p.product_id, variant_id: null, warehouse_id: warehouseId, quantity: p.quantity }))
        : []
      const res = await fetch(`/api/sales?id=${sale.id}&restoreStock=${restoreStock}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restorations,
          actor_id:   user?.id,
          actor_name: user?.name,
          actor_role: user?.role,
          sale_total: sale.total_amount,
          sale_event: sale.event?.name ?? null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setDeleteError((err as { error?: string }).error ?? `Error ${res.status} al eliminar la venta`)
      } else {
        refetch()
      }
    } catch {
      setDeleteError('Error de conexión al eliminar la venta')
    } finally {
      setDeletingId(null)
    }
  }

  const openEdit = (sale: Sale) => {
    setEditAmount(String(sale.total_amount))
    setEditPayment(sale.payment_method)
    setEditNotes(sale.notes ?? '')
    setEditError('')
    setEditingSale(sale)
    setSelectedSale(null)
  }

  const handleSaveEdit = async () => {
    if (!editingSale) return
    setEditError('')
    // Normalizar decimales: admitir tanto punto como coma (ej: "5,99" → 5.99)
    const normalizedAmount = editAmount.replace(',', '.')
    const parsedAmount = parseFloat(normalizedAmount)
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      setEditError('Introduce un importe válido')
      return
    }
    setSavingEdit(true)
    try {
      const res = await fetch('/api/sales', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSale.id,
          total_amount: parsedAmount,
          payment_method: editPayment,
          notes: editNotes,
        }),
      })
      if (res.ok) {
        setEditingSale(null)
        refetch()
      } else {
        const err = await res.json().catch(() => ({}))
        setEditError(err.error ?? `Error ${res.status}`)
      }
    } catch {
      setEditError('Error de conexión')
    } finally {
      setSavingEdit(false)
    }
  }

  const exportCSV = () => {
    const rows = [
      ['Fecha', 'Hora', 'Concierto', 'Vendedor', 'Método', 'Total', 'Beneficio', 'Productos', 'Notas'],
      ...sales.map(s => [
        new Date(s.created_at).toLocaleDateString('es-ES'),
        new Date(s.created_at).toLocaleTimeString('es-ES'),
        s.event?.name ?? '',
        s.user?.name ?? '',
        s.payment_method,
        String(s.total_amount),
        String(s.profit),
        s.items?.map(i => `${i.quantity}x ${i.product?.name ?? i.pack?.name ?? '?'}`).join(', ') ?? '',
        s.notes ?? '',
      ]),
    ]
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Historial de ventas"
        subtitle={`${total} venta${total !== 1 ? 's' : ''}`}
        actions={
          !isSaleMode && (
            <div className="flex items-center gap-2">
              <button onClick={exportCSV} className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-500">
                <Download size={18} />
              </button>
              <button
                onClick={() => setShowFilters(true)}
                className={`p-2 rounded-xl ${Object.keys(filters).length > 0 ? 'bg-white text-black' : 'hover:bg-zinc-800 text-zinc-500'}`}
              >
                <Filter size={18} />
              </button>
            </div>
          )
        }
      />

      {/* TPV: banner con el evento activo. Si no hay, aviso. */}
      {isSaleMode && (
        <div className="px-4 pt-3 shrink-0">
          {activeEvent ? (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-900/50 rounded-xl px-3 py-2">
              <CalendarDays size={14} className="text-amber-400 shrink-0" />
              <p className="text-amber-300 text-xs font-semibold truncate">
                Ventas de: <span className="text-white">{activeEvent.name}</span>
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2">
              <CalendarDays size={14} className="text-zinc-500 shrink-0" />
              <p className="text-zinc-400 text-xs">Selecciona un concierto en el TPV para ver su historial.</p>
            </div>
          )}
        </div>
      )}

      {/* Admin: tabs deslizables (Totales / En conciertos / Rápidas). TPV: lista directa. */}
      {isSaleMode ? (
        <ScopeContent
          panelScope="events"
          sales={sales}
          loading={loading}
          isSaleMode
          filters={filters}
          clearFilters={() => setFilters({})}
          deletingId={deletingId}
          onSelect={(s) => setSelectedSale(s)}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      ) : (
        <SwipeableTabs
          activeKey={scope}
          onChange={k => setScope(k as ScopeTab)}
          tabs={[
            { key: 'all',    label: <TabLabel text="Totales"        count={sales.length} active={scope === 'all'} />,    content: (
              <ScopeContent panelScope="all"    sales={sales} loading={loading} isSaleMode={false}
                filters={filters} clearFilters={() => setFilters({})}
                deletingId={deletingId} onSelect={(s) => setSelectedSale(s)} onEdit={openEdit} onDelete={handleDelete} />
            )},
            { key: 'events', label: <TabLabel text="Conciertos"  count={eventCount}   active={scope === 'events'} />, content: (
              <ScopeContent panelScope="events" sales={sales} loading={loading} isSaleMode={false}
                filters={filters} clearFilters={() => setFilters({})}
                deletingId={deletingId} onSelect={(s) => setSelectedSale(s)} onEdit={openEdit} onDelete={handleDelete} />
            )},
            { key: 'quick',  label: <TabLabel text="Rápidas"        count={quickCount}   active={scope === 'quick'} />,  content: (
              <ScopeContent panelScope="quick"  sales={sales} loading={loading} isSaleMode={false}
                filters={filters} clearFilters={() => setFilters({})}
                deletingId={deletingId} onSelect={(s) => setSelectedSale(s)} onEdit={openEdit} onDelete={handleDelete} />
            )},
            { key: 'web',    label: <TabLabel text="Web"            count={webCount}     active={scope === 'web'} />,    content: (
              <ScopeContent panelScope="web"    sales={sales} loading={loading} isSaleMode={false}
                filters={filters} clearFilters={() => setFilters({})}
                deletingId={deletingId} onSelect={(s) => setSelectedSale(s)} onEdit={openEdit} onDelete={handleDelete} />
            )},
          ]}
        />
      )}

      {/* Modal detalle */}
      <Modal open={!!selectedSale} onClose={() => setSelectedSale(null)} title="Detalle de venta" size="md">
        {selectedSale && (
          <div className="space-y-4">
            <div className={`grid gap-3 ${isSaleMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <div className="bg-zinc-800 rounded-xl p-3">
                <p className="text-zinc-500 text-xs">Total cobrado</p>
                <p className="text-white font-black text-lg">{formatCurrency(selectedSale.total_amount)}</p>
              </div>
              {!isSaleMode && (
                <div className={`rounded-xl p-3 ${selectedSale.profit < 0 ? 'bg-red-950/40' : 'bg-zinc-800'}`}>
                  <p className="text-zinc-500 text-xs">Beneficio</p>
                  <p className={`font-black text-lg ${selectedSale.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(selectedSale.profit)}</p>
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between py-1 border-b border-zinc-800">
                <span className="text-zinc-500">Fecha</span>
                <span className="text-white">{formatDateTime(selectedSale.created_at)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-zinc-800">
                <span className="text-zinc-500">Pago</span>
                <span className="text-white">{paymentLabels[selectedSale.payment_method]}</span>
              </div>
              {selectedSale.event && (
                <div className="flex justify-between py-1 border-b border-zinc-800">
                  <span className="text-zinc-500">Concierto</span>
                  <span className="text-white">{selectedSale.event.name}</span>
                </div>
              )}
              {(selectedSale.seller_name ?? selectedSale.user?.name) && (
                <div className="flex justify-between py-1">
                  <span className="text-zinc-500">Vendedor</span>
                  <span className="flex items-center gap-2">
                    <span className="text-white">{selectedSale.seller_name ?? selectedSale.user?.name}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      selectedSale.seller_type === 'tpv'
                        ? 'bg-blue-950/60 text-blue-400'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {selectedSale.seller_type === 'tpv' ? 'TPV' : 'Admin'}
                    </span>
                  </span>
                </div>
              )}
              {selectedSale.sale_channel === 'web' && (
                <>
                  <div className="flex justify-between py-1 border-t border-zinc-800">
                    <span className="text-zinc-500">Envío cobrado</span>
                    <span className="text-white">{formatCurrency(selectedSale.shipping_cost ?? 0)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">Envío real</span>
                    <span className="text-white">{formatCurrency(selectedSale.shipping_actual_cost ?? 0)}</span>
                  </div>
                  {(() => {
                    const diff = (selectedSale.shipping_cost ?? 0) - (selectedSale.shipping_actual_cost ?? 0)
                    if (Math.abs(diff) < 0.001) return null
                    return (
                      <div className="flex justify-between py-1">
                        <span className="text-zinc-500">Diferencia envío</span>
                        <span className={diff >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                          {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                        </span>
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
            {selectedSale.notes && (
              <div className="bg-amber-950/30 border border-amber-900/50 rounded-xl px-3 py-2.5">
                <p className="text-xs text-zinc-400 font-medium mb-1">Notas</p>
                <p className="text-zinc-200 text-sm">{selectedSale.notes}</p>
              </div>
            )}
            {selectedSale.items && selectedSale.items.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Artículos vendidos</p>
                <div className="space-y-1.5">
                  {selectedSale.items.map(item => {
                    // Almacén de origen: usa el persistido en sale_items; si no hay y
                    // existe un único almacén global, muéstralo.
                    const warehouseName = item.warehouse?.name
                      ?? (warehouses.length === 1 ? warehouses[0].name : null)
                    return (
                      <div key={item.id}>
                        <div className="flex items-center gap-2 py-1.5">
                          <span className="text-zinc-500 text-sm w-5 shrink-0">{item.quantity}×</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {item.pack_id && (
                                <Package2 size={11} className="text-zinc-500 shrink-0" />
                              )}
                              <span className="text-white text-sm truncate">
                                {item.product?.name ?? item.pack?.name ?? '?'}
                              </span>
                            </div>
                            {item.pack_id && item.pack && (
                              <p className="text-zinc-600 text-xs mt-0.5 truncate">Pack incluido</p>
                            )}
                            {warehouseName && (
                              <p className="inline-flex items-center gap-1 text-[10px] text-zinc-500 mt-0.5">
                                <Warehouse size={9} />
                                {warehouseName}
                              </p>
                            )}
                          </div>
                          <span className="text-white text-sm font-medium shrink-0">{formatCurrency(item.subtotal)}</span>
                        </div>
                        {item.pack_id && (
                          <div className="ml-7 border-b border-zinc-800 pb-1.5" />
                        )}
                        {!item.pack_id && (
                          <div className="border-b border-zinc-800 last:border-0" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {!isSaleMode && (
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  fullWidth
                  onClick={() => openEdit(selectedSale)}
                  className="border-zinc-700"
                >
                  <Pencil size={14} />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  fullWidth
                  onClick={() => handleDelete(selectedSale)}
                  disabled={deletingId === selectedSale.id}
                  className="text-red-500 border-red-900 hover:bg-red-950/30"
                >
                  <Trash2 size={14} />
                  {deletingId === selectedSale.id ? 'Eliminando...' : 'Eliminar'}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal edición */}
      <Modal open={!!editingSale} onClose={() => setEditingSale(null)} title="Editar venta" size="md">
        {editingSale && (
          <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Importe cobrado (€)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editAmount}
                onChange={e => setEditAmount(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Método de pago</label>
              <select
                value={editPayment}
                onChange={e => setEditPayment(e.target.value as PaymentMethod)}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              >
                {Object.entries(paymentLabels).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Notas</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                placeholder="Añade una nota..."
                rows={3}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-white resize-none text-sm"
              />
            </div>
            {editError && (
              <p className="text-red-400 text-xs text-center bg-red-950/50 border border-red-900 rounded-xl py-2 px-3">
                {editError}
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <Button variant="outline" fullWidth onClick={() => setEditingSale(null)}>
                Cancelar
              </Button>
              <Button fullWidth onClick={handleSaveEdit} loading={savingEdit}>
                Guardar cambios
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal confirmación eliminación */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Eliminar venta" size="sm">
        {deleteConfirm && (() => {
          const hasItems = deleteConfirm.sale.items && deleteConfirm.sale.items.length > 0
          const singleWarehouseName = warehouses.length === 1 ? warehouses[0].name : null
          const setMode = (m: RestoreMode) => setDeleteConfirm(prev => prev ? { ...prev, mode: m } : null)
          const isWebSale = deleteConfirm.sale.sale_channel === 'web'
          return (
            <div className="space-y-4">
              <p className="text-zinc-300 text-sm">
                ¿Seguro que quieres eliminar {isWebSale ? 'este pedido web' : 'esta venta'} de{' '}
                <span className="text-white font-semibold">{formatCurrency(deleteConfirm.sale.total_amount)}</span>?
                Esta acción no se puede deshacer.
              </p>

              {hasItems && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-400">¿Qué hacer con el stock?</p>

                  {/* Opción 1: por defecto, almacenes de origen */}
                  <RestoreModeOption
                    selected={deleteConfirm.mode === 'origin'}
                    onSelect={() => setMode('origin')}
                    title={singleWarehouseName
                      ? `Devolver a ${singleWarehouseName}`
                      : 'Devolver a sus almacenes de origen'}
                    description={singleWarehouseName
                      ? `Cada artículo vuelve al almacén ${singleWarehouseName}.`
                      : 'Cada artículo vuelve al almacén desde el que se vendió.'}
                  />

                  {/* Opción 2: elegir un único almacén destino */}
                  <RestoreModeOption
                    selected={deleteConfirm.mode === 'custom'}
                    onSelect={() => setMode('custom')}
                    title="Devolver a otro almacén"
                    description="Elige manualmente el almacén destino para todos los artículos."
                  />

                  {/* Opción 3: no restaurar */}
                  <RestoreModeOption
                    selected={deleteConfirm.mode === 'none'}
                    onSelect={() => setMode('none')}
                    title="No restaurar stock"
                    description="Solo borrar la venta. El stock no se reincorpora."
                  />
                </div>
              )}

              {hasItems && deleteConfirm.mode === 'custom' && deleteConfirm.itemPlans.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-zinc-400">Almacén destino</label>
                    <select
                      value={deleteConfirm.warehouseId}
                      onChange={e => setDeleteConfirm(prev => prev ? { ...prev, warehouseId: e.target.value } : null)}
                      className="bg-zinc-800 border border-zinc-700 rounded-xl py-2 px-3 text-white text-sm focus:outline-none focus:border-white"
                    >
                      <option value="">Selecciona un almacén</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>

                  {deleteConfirm.warehouseId && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-zinc-500">Elige qué artículos devolver:</p>
                      {deleteConfirm.itemPlans.map((plan, idx) => (
                        <button
                          key={plan.sale_item_id}
                          type="button"
                          onClick={() => setDeleteConfirm(prev => prev
                            ? { ...prev, itemPlans: prev.itemPlans.map((p, i) => i === idx ? { ...p, include: !p.include } : p) }
                            : null
                          )}
                          className="w-full flex items-center gap-3 bg-zinc-800 hover:bg-zinc-700/70 border border-zinc-700 rounded-xl p-2.5 transition-colors text-left"
                        >
                          <div className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${plan.include ? 'bg-white border-white' : 'border-zinc-500'}`}>
                            {plan.include && (
                              <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-black fill-current">
                                <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span className="text-white text-sm flex-1 truncate">{plan.product_name}</span>
                          <span className="text-zinc-400 text-xs shrink-0">{plan.quantity} ud</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" fullWidth onClick={() => setDeleteConfirm(null)} className="border-zinc-700">
                  Cancelar
                </Button>
                <Button
                  variant="outline"
                  fullWidth
                  onClick={confirmDelete}
                  disabled={deleteConfirm.mode === 'custom' && !deleteConfirm.warehouseId}
                  className="text-red-500 border-red-900 hover:bg-red-950/30"
                >
                  <Trash2 size={14} />
                  Eliminar
                </Button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Error de eliminación */}
      {deleteError && (
        <div className="fixed bottom-24 left-4 right-4 z-50 bg-red-950 border border-red-800 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-red-400 text-sm">{deleteError}</p>
          <button onClick={() => setDeleteError('')} className="text-red-500 shrink-0"><X size={16} /></button>
        </div>
      )}

      {/* Modal filtros */}
      <Modal open={showFilters} onClose={() => setShowFilters(false)} title="Filtros" size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Desde</label>
              <input
                type="date"
                value={filters.date_from ?? ''}
                onChange={e => setFilters(f => ({ ...f, date_from: e.target.value || undefined }))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Hasta</label>
              <input
                type="date"
                value={filters.date_to ?? ''}
                onChange={e => setFilters(f => ({ ...f, date_to: e.target.value || undefined }))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-zinc-400">Concierto</label>
            <select
              value={filters.event_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, event_id: e.target.value || undefined }))}
              className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
            >
              <option value="">Todos los conciertos</option>
              {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-zinc-400">Método de pago</label>
            <select
              value={filters.payment_method ?? ''}
              onChange={e => setFilters(f => ({ ...f, payment_method: (e.target.value as PaymentMethod) || undefined }))}
              className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
            >
              <option value="">Todos</option>
              {Object.entries(paymentLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-zinc-400">Canal</label>
            <select
              value={filters.sale_channel ?? ''}
              onChange={e => setFilters(f => ({ ...f, sale_channel: (e.target.value as SaleChannel) || undefined }))}
              className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
            >
              <option value="">Todos</option>
              <option value="pos">Presencial (rápida o concierto)</option>
              <option value="web">Pedido web</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Precio mínimo (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={filters.amount_min ?? ''}
                onChange={e => setFilters(f => ({ ...f, amount_min: e.target.value ? parseFloat(e.target.value) : undefined }))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-zinc-400">Precio máximo (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Sin límite"
                value={filters.amount_max ?? ''}
                onChange={e => setFilters(f => ({ ...f, amount_max: e.target.value ? parseFloat(e.target.value) : undefined }))}
                className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" fullWidth onClick={() => { setFilters({}); setShowFilters(false) }}>
              Limpiar
            </Button>
            <Button fullWidth onClick={() => setShowFilters(false)}>
              Aplicar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SaleRow({
  sale, isSaleMode, deletingId, onSelect, onEdit, onDelete,
}: {
  sale: Sale
  isSaleMode: boolean
  deletingId: string | null
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const Icon = paymentIcons[sale.payment_method] ?? Banknote
  const color = paymentColors[sale.payment_method] ?? 'text-zinc-400'

  return (
    <Card padding="none">
      <div
        className="flex items-center gap-3 p-3 cursor-pointer active:bg-zinc-800/50"
        onClick={onSelect}
      >
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
          <Icon size={18} className={color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-white font-semibold text-sm">{formatCurrency(sale.total_amount)}</p>
            {sale.sale_channel === 'web' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-950/60 text-purple-300 border border-purple-900/50">
                <Globe size={9} />
                Web
              </span>
            ) : sale.event ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-900/50">
                <CalendarDays size={9} />
                {sale.event.name}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                <Zap size={9} />
                Rápida
              </span>
            )}
            {!sale.synced && <Badge variant="warning">Pendiente sync</Badge>}
            {sale.notes && <MessageSquare size={12} className="text-zinc-400 shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-zinc-500 text-xs">{formatDateTime(sale.created_at)}</p>
            {(sale.seller_name ?? sale.user?.name) && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                sale.seller_type === 'tpv'
                  ? 'bg-blue-950/60 text-blue-400'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {sale.seller_name ?? sale.user?.name}
              </span>
            )}
          </div>
          {sale.items && (
            <p className="text-zinc-600 text-xs truncate">
              {sale.items.map(i => `${i.quantity}× ${i.product?.name ?? i.pack?.name ?? '?'}`).join(', ')}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          {!isSaleMode && (
            <p className={`text-sm font-bold ${sale.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
              {sale.profit < 0 ? '' : '+'}{formatCurrency(sale.profit)}
            </p>
          )}
          <p className="text-zinc-600 text-xs">{paymentLabels[sale.payment_method]}</p>
        </div>
      </div>
      {!isSaleMode && (
        <div className="px-3 pb-3 pt-1 flex gap-2">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 active:scale-[0.98] transition-all"
          >
            <Pencil size={13} />
            Editar
          </button>
          <button
            onClick={onDelete}
            disabled={deletingId === sale.id}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-950/40 border border-red-900/70 text-xs font-semibold text-red-400 hover:bg-red-950/70 active:scale-[0.98] transition-all disabled:opacity-40"
          >
            <Trash2 size={13} />
            {deletingId === sale.id ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      )}
    </Card>
  )
}

function RestoreModeOption({ selected, onSelect, title, description }: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-start gap-3 rounded-xl p-3 text-left border transition-colors ${
        selected
          ? 'bg-white/10 border-white'
          : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700/70'
      }`}
    >
      <div className={`mt-0.5 w-4 h-4 rounded-full shrink-0 border-2 flex items-center justify-center transition-colors ${selected ? 'border-white' : 'border-zinc-500'}`}>
        {selected && <div className="w-2 h-2 rounded-full bg-white" />}
      </div>
      <div>
        <p className="text-white text-sm font-medium">{title}</p>
        <p className="text-zinc-500 text-xs mt-0.5">{description}</p>
      </div>
    </button>
  )
}

function TabLabel({ text, count, active }: { text: string; count: number; active: boolean }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      {text}
      {count > 0 && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-white/15 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
          {count}
        </span>
      )}
    </span>
  )
}

// Renderiza resumen + lista filtrados por scope. Cada panel del slide lo usa
// con un panelScope distinto, así el slide horizontal cambia el contenido.
function ScopeContent({
  panelScope, sales, loading, isSaleMode,
  filters, clearFilters,
  deletingId, onSelect, onEdit, onDelete,
}: {
  panelScope: ScopeTab
  sales: Sale[]
  loading: boolean
  isSaleMode: boolean
  filters: SaleFilters
  clearFilters: () => void
  deletingId: string | null
  onSelect: (s: Sale) => void
  onEdit: (s: Sale) => void
  onDelete: (s: Sale) => void
}) {
  // Para conciertos y rápidas excluimos las ventas web (van en su propia pestaña)
  const scoped = panelScope === 'events'
    ? sales.filter(s => !!s.event_id && s.sale_channel !== 'web')
    : panelScope === 'quick'
      ? sales.filter(s => !s.event_id && s.sale_channel !== 'web')
      : panelScope === 'web'
        ? sales.filter(s => s.sale_channel === 'web')
        : sales

  const totalRevenue = scoped.reduce((a, s) => a + s.total_amount, 0)
  const totalProfit  = scoped.reduce((a, s) => a + s.profit, 0)

  const grouped = panelScope === 'events'
    ? (() => {
        const map = new Map<string, { event: Sale['event']; sales: Sale[] }>()
        for (const s of scoped) {
          const key = s.event_id ?? '__none__'
          if (!map.has(key)) map.set(key, { event: s.event, sales: [] })
          map.get(key)!.sales.push(s)
        }
        return Array.from(map.values())
      })()
    : []

  return (
    <div className="h-full flex flex-col">
      {/* Resumen */}
      {scoped.length > 0 && (
        <div className={`grid gap-2 px-4 pt-3 shrink-0 ${isSaleMode ? 'grid-cols-2' : 'grid-cols-3'}`}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-zinc-500 text-xs">Ventas</p>
            <p className="text-white font-black text-lg">{scoped.length}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-zinc-500 text-xs">Ingresos</p>
            <p className="text-white font-black text-sm">{formatCurrency(totalRevenue)}</p>
          </div>
          {!isSaleMode && (
            <div className={`border rounded-xl p-3 text-center ${totalProfit < 0 ? 'bg-red-950/30 border-red-900/50' : 'bg-zinc-900 border-zinc-800'}`}>
              <p className="text-zinc-500 text-xs">Beneficio</p>
              <p className={`font-black text-sm ${totalProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(totalProfit)}</p>
            </div>
          )}
        </div>
      )}

      {/* Filtros activos */}
      {Object.keys(filters).length > 0 && (
        <div className="px-4 pt-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Filtros activos:</span>
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-white hover:text-zinc-300">
              <X size={12} />
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : scoped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Clock size={40} />
            <p className="mt-3 text-sm">
              {panelScope === 'events' ? 'No hay ventas en conciertos'
                : panelScope === 'quick' ? 'No hay ventas rápidas'
                : panelScope === 'web' ? 'No hay pedidos web'
                : 'No hay ventas registradas'}
            </p>
          </div>
        ) : panelScope === 'events' ? (
          grouped.map(group => {
            const groupRevenue = group.sales.reduce((a, s) => a + s.total_amount, 0)
            return (
              <div key={group.event?.id ?? '__none__'} className="space-y-2">
                <div className="flex items-center gap-2 pt-2 pb-1">
                  <CalendarDays size={14} className="text-amber-500" />
                  <p className="text-white font-bold text-sm flex-1 truncate">
                    {group.event?.name ?? 'Concierto eliminado'}
                  </p>
                  <span className="text-amber-400 text-xs font-semibold">{formatCurrency(groupRevenue)}</span>
                  <span className="text-zinc-500 text-xs">· {group.sales.length} venta{group.sales.length !== 1 ? 's' : ''}</span>
                </div>
                {group.sales.map(sale => (
                  <SaleRow
                    key={sale.id}
                    sale={sale}
                    isSaleMode={isSaleMode}
                    deletingId={deletingId}
                    onSelect={() => onSelect(sale)}
                    onEdit={() => onEdit(sale)}
                    onDelete={() => onDelete(sale)}
                  />
                ))}
              </div>
            )
          })
        ) : (
          scoped.map(sale => (
            <SaleRow
              key={sale.id}
              sale={sale}
              isSaleMode={isSaleMode}
              deletingId={deletingId}
              onSelect={() => onSelect(sale)}
              onEdit={() => onEdit(sale)}
              onDelete={() => onDelete(sale)}
            />
          ))
        )}
      </div>
    </div>
  )
}
