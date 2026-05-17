'use client'
import { useState, useEffect } from 'react'
import { Clock, Filter, Banknote, Smartphone, CreditCard, Wallet, Download, X, Trash2, MessageSquare, Pencil, Package2 } from 'lucide-react'
import { useSalesHistory } from '@/hooks/useSales'
import { useEvents } from '@/hooks/useEvents'
import { useAppStore } from '@/store/appStore'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import type { Sale, PaymentMethod, SaleFilters } from '@/types'

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
  const [deleteConfirm, setDeleteConfirm] = useState<{ sale: Sale; restoreStock: boolean } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editAmount, setEditAmount] = useState('')
  const [editPayment, setEditPayment] = useState<PaymentMethod>('efectivo')
  const [editNotes, setEditNotes] = useState('')
  const [editError, setEditError] = useState('')
  const { sales, loading, total, refetch } = useSalesHistory(filters)
  const { isSaleMode } = useAppStore()

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

  const handleDelete = (sale: Sale) => {
    setSelectedSale(null)
    setDeleteConfirm({ sale, restoreStock: true })
  }

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    const { sale, restoreStock } = deleteConfirm
    setDeleteConfirm(null)
    setDeleteError('')
    setDeletingId(sale.id)
    try {
      const res = await fetch(`/api/sales?id=${sale.id}&restoreStock=${restoreStock}`, { method: 'DELETE' })
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

  const totalRevenue = sales.reduce((a, s) => a + s.total_amount, 0)
  const totalProfit = sales.reduce((a, s) => a + s.profit, 0)

  const exportCSV = () => {
    const rows = [
      ['Fecha', 'Hora', 'Evento', 'Vendedor', 'Método', 'Total', 'Beneficio', 'Productos', 'Notas'],
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
        }
      />

      {/* Resumen */}
      {sales.length > 0 && (
        <div className="grid grid-cols-3 gap-2 px-4 pt-4 shrink-0">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-zinc-500 text-xs">Ventas</p>
            <p className="text-white font-black text-lg">{sales.length}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-zinc-500 text-xs">Ingresos</p>
            <p className="text-white font-black text-sm">{formatCurrency(totalRevenue)}</p>
          </div>
          <div className={`border rounded-xl p-3 text-center ${totalProfit < 0 ? 'bg-red-950/30 border-red-900/50' : 'bg-zinc-900 border-zinc-800'}`}>
            <p className="text-zinc-500 text-xs">Beneficio</p>
            <p className={`font-black text-sm ${totalProfit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(totalProfit)}</p>
          </div>
        </div>
      )}

      {/* Filtros activos */}
      {Object.keys(filters).length > 0 && (
        <div className="px-4 pt-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Filtros activos:</span>
            <button
              onClick={() => setFilters({})}
              className="flex items-center gap-1 text-xs text-white hover:text-zinc-300"
            >
              <X size={12} />
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sales.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Clock size={40} />
            <p className="mt-3 text-sm">No hay ventas registradas</p>
          </div>
        ) : (
          sales.map(sale => {
            const Icon = paymentIcons[sale.payment_method] ?? Banknote
            const color = paymentColors[sale.payment_method] ?? 'text-zinc-400'
            return (
              <Card key={sale.id} padding="none">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer active:bg-zinc-800/50"
                  onClick={() => setSelectedSale(sale)}
                >
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0">
                    <Icon size={18} className={color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold text-sm">{formatCurrency(sale.total_amount)}</p>
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
                    <p className={`text-sm font-bold ${sale.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {sale.profit < 0 ? '' : '+'}{formatCurrency(sale.profit)}
                    </p>
                    <p className="text-zinc-600 text-xs">{paymentLabels[sale.payment_method]}</p>
                  </div>
                </div>
                {!isSaleMode && (
                  <div className="border-t border-zinc-800 flex">
                    <button
                      onClick={() => openEdit(sale)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-zinc-400 hover:bg-zinc-800/50 transition-colors border-r border-zinc-800"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(sale)}
                      disabled={deletingId === sale.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs text-red-500 hover:bg-red-950/30 transition-colors disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                      {deletingId === sale.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      {/* Modal detalle */}
      <Modal open={!!selectedSale} onClose={() => setSelectedSale(null)} title="Detalle de venta" size="md">
        {selectedSale && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-800 rounded-xl p-3">
                <p className="text-zinc-500 text-xs">Total cobrado</p>
                <p className="text-white font-black text-lg">{formatCurrency(selectedSale.total_amount)}</p>
              </div>
              <div className={`rounded-xl p-3 ${selectedSale.profit < 0 ? 'bg-red-950/40' : 'bg-zinc-800'}`}>
                <p className="text-zinc-500 text-xs">Beneficio</p>
                <p className={`font-black text-lg ${selectedSale.profit < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(selectedSale.profit)}</p>
              </div>
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
                  <span className="text-zinc-500">Evento</span>
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
                  {selectedSale.items.map(item => (
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
                  ))}
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
        {deleteConfirm && (
          <div className="space-y-4">
            <p className="text-zinc-300 text-sm">
              ¿Seguro que quieres eliminar esta venta de{' '}
              <span className="text-white font-semibold">{formatCurrency(deleteConfirm.sale.total_amount)}</span>?
              Esta acción no se puede deshacer.
            </p>
            {deleteConfirm.sale.items && deleteConfirm.sale.items.length > 0 && (
              <button
                type="button"
                onClick={() => setDeleteConfirm(prev => prev ? { ...prev, restoreStock: !prev.restoreStock } : null)}
                className="w-full flex items-start gap-3 bg-zinc-800 hover:bg-zinc-700/70 border border-zinc-700 rounded-xl p-3 transition-colors text-left"
              >
                <div className={`mt-0.5 w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center transition-colors ${deleteConfirm.restoreStock ? 'bg-white border-white' : 'border-zinc-500'}`}>
                  {deleteConfirm.restoreStock && (
                    <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 text-black fill-current">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <div>
                  <p className="text-white text-sm font-medium">Restaurar stock</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    Devolver al inventario los productos incluidos en esta venta
                  </p>
                </div>
              </button>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" fullWidth onClick={() => setDeleteConfirm(null)} className="border-zinc-700">
                Cancelar
              </Button>
              <Button
                variant="outline"
                fullWidth
                onClick={confirmDelete}
                className="text-red-500 border-red-900 hover:bg-red-950/30"
              >
                <Trash2 size={14} />
                Eliminar
              </Button>
            </div>
          </div>
        )}
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
            <label className="text-sm text-zinc-400">Evento</label>
            <select
              value={filters.event_id ?? ''}
              onChange={e => setFilters(f => ({ ...f, event_id: e.target.value || undefined }))}
              className="bg-zinc-800 border border-zinc-700 rounded-xl py-2.5 px-3 text-white text-sm focus:outline-none focus:border-white"
            >
              <option value="">Todos los eventos</option>
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
