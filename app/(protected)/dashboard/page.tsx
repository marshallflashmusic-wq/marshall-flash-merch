'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShoppingBag, Package, AlertTriangle,
  Banknote, CreditCard, Smartphone, Wallet, LogOut,
  Warehouse, CalendarDays, HelpCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { formatCurrency } from '@/lib/utils'
import TopBar from '@/components/layout/TopBar'
import Card from '@/components/ui/Card'
import type { DashboardStats } from '@/types'

const paymentIcons = {
  efectivo: Banknote,
  bizum: Smartphone,
  tarjeta: CreditCard,
  paypal: Wallet,
  mixto: Wallet,
}

const paymentLabels = {
  efectivo: 'Efectivo',
  bizum: 'Bizum',
  tarjeta: 'Tarjeta',
  paypal: 'PayPal',
  mixto: 'Mixto',
}

const LOW_STOCK_THRESHOLD = 3

export default function DashboardPage() {
  const router = useRouter()
  const { user } = useAppStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [lowStockProducts, setLowStockProducts] = useState<{ name: string; stock: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const today = new Date().toISOString().split('T')[0]

      const [salesRes, productsRes] = await Promise.all([
        supabase
          .from('sales')
          .select('*, items:sale_items(*, product:products(name, purchase_price))')
          .gte('created_at', today)
          .lte('created_at', today + 'T23:59:59'),
        supabase.from('products').select('id, name, stock, min_stock').eq('active', true),
      ])

      const sales = salesRes.data ?? []
      const products = productsRes.data ?? []

      const revenue = sales.reduce((a, s) => a + (s.total_amount ?? 0), 0)
      const profit = sales.reduce((a, s) => a + (s.profit ?? 0), 0)
      const itemsSold = sales.reduce((a, s) => a + (s.items?.reduce((b: number, i: { quantity: number }) => b + i.quantity, 0) ?? 0), 0)

      const byPayment = sales.reduce((acc: Record<string, { total: number; count: number }>, s) => {
        const m = s.payment_method ?? 'efectivo'
        if (!acc[m]) acc[m] = { total: 0, count: 0 }
        acc[m].total += s.total_amount ?? 0
        acc[m].count += 1
        return acc
      }, {})

      const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {}
      for (const sale of sales) {
        for (const item of (sale.items ?? [])) {
          if (item.product) {
            const pid = item.product_id
            if (!productSales[pid]) productSales[pid] = { name: item.product.name, quantity: 0, revenue: 0 }
            productSales[pid].quantity += item.quantity
            productSales[pid].revenue += item.subtotal ?? 0
          }
        }
      }

      const lowStockList = products
        .filter(p => p.stock > 0 && p.stock < LOW_STOCK_THRESHOLD)
        .map(p => ({ name: p.name, stock: p.stock }))
        .sort((a, b) => a.stock - b.stock)

      setLowStockProducts(lowStockList)
      setStats({
        sales_today: sales.length,
        revenue_today: revenue,
        profit_today: profit,
        items_sold_today: itemsSold,
        low_stock_count: lowStockList.length,
        top_products: Object.values(productSales).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
        sales_by_payment: Object.entries(byPayment).map(([method, data]) => ({
          method: method as keyof typeof paymentLabels,
          ...data,
        })),
      })
      setLoading(false)
    }
    load()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <TopBar
        title="Dashboard"
        subtitle={user?.name ?? 'Admin'}
        actions={
          <button
            onClick={handleLogout}
            className="p-2 rounded-xl hover:bg-zinc-800 text-zinc-500"
          >
            <LogOut size={18} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Stats principales */}
        <div className="grid grid-cols-3 gap-3">
          <Card padding="md" className="bg-white/5 border-white/20">
            <div className="flex flex-col gap-1">
              <p className="text-white/60 text-xs font-medium uppercase tracking-wider">Ingresos</p>
              <p className="text-white text-xl font-black">{formatCurrency(stats?.revenue_today ?? 0)}</p>
            </div>
          </Card>
          <Card padding="md" className={`${(stats?.profit_today ?? 0) < 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
            <div className="flex flex-col gap-1">
              <p className={`text-xs font-medium uppercase tracking-wider ${(stats?.profit_today ?? 0) < 0 ? 'text-red-400/70' : 'text-green-400/70'}`}>Beneficio</p>
              <p className={`text-xl font-black ${(stats?.profit_today ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}`}>{formatCurrency(stats?.profit_today ?? 0)}</p>
            </div>
          </Card>
          <Card padding="md">
            <div className="flex flex-col gap-1">
              <p className="text-zinc-500 text-xs font-medium uppercase tracking-wider">Ventas</p>
              <p className="text-white text-xl font-black">{stats?.sales_today ?? 0}</p>
            </div>
          </Card>
        </div>

        {/* Stock bajo */}
        {lowStockProducts.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-red-500" />
              Stock bajo
            </h2>
            <Card padding="none" className="bg-red-500/5 border-red-500/20">
              {lowStockProducts.map((p, idx) => (
                <div
                  key={p.name}
                  className={`flex items-center justify-between px-4 py-2.5 ${idx < lowStockProducts.length - 1 ? 'border-b border-red-900/30' : ''}`}
                >
                  <p className="text-white text-sm">{p.name}</p>
                  <span className="text-red-400 font-bold text-sm">{p.stock} ud{p.stock !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Métodos de pago */}
        {stats?.sales_by_payment && stats.sales_by_payment.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Por método de pago</h2>
            <Card padding="none">
              {stats.sales_by_payment.map((item, idx) => {
                const Icon = paymentIcons[item.method as keyof typeof paymentIcons] ?? Wallet
                return (
                  <div key={item.method} className={`flex items-center gap-3 px-4 py-3 ${idx < stats.sales_by_payment.length - 1 ? 'border-b border-zinc-800' : ''}`}>
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                      <Icon size={16} className="text-zinc-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{paymentLabels[item.method as keyof typeof paymentLabels] ?? item.method}</p>
                      <p className="text-xs text-zinc-500">{item.count} venta{item.count !== 1 ? 's' : ''}</p>
                    </div>
                    <p className="font-bold text-white">{formatCurrency(item.total)}</p>
                  </div>
                )
              })}
            </Card>
          </div>
        )}

        {/* Productos más vendidos */}
        {stats?.top_products && stats.top_products.length > 0 && (
          <div>
            <button
              onClick={() => router.push('/sales/history')}
              className="w-full flex items-center justify-between mb-2 group"
            >
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider group-hover:text-zinc-300 transition-colors">Más vendidos hoy</h2>
              <span className="text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors">Ver historial →</span>
            </button>
            <Card padding="none" interactive onClick={() => router.push('/sales/history')}>
              {stats.top_products.map((p, idx) => (
                <div key={p.name} className={`flex items-center gap-3 px-4 py-3 ${idx < (stats.top_products?.length ?? 0) - 1 ? 'border-b border-zinc-800' : ''}`}>
                  <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-zinc-400">{idx + 1}</span>
                  </div>
                  <Package size={16} className="text-zinc-500 shrink-0" />
                  <p className="flex-1 text-sm text-white truncate">{p.name}</p>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">{p.quantity} uds</p>
                    <p className="text-xs text-zinc-500">{formatCurrency(p.revenue)}</p>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}

        {/* Acceso rápido */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Acceso rápido</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Card interactive onClick={() => router.push('/events')} padding="md" className="bg-amber-500/10 border-amber-500/30">
              <div className="flex flex-col items-center gap-2 py-2">
                <CalendarDays size={26} className="text-amber-400" />
                <span className="text-xs font-bold text-amber-300 text-center leading-tight">Conciertos</span>
              </div>
            </Card>
            <Card interactive onClick={() => router.push('/help')} padding="md">
              <div className="flex flex-col items-center gap-2 py-2">
                <HelpCircle size={26} className="text-zinc-400" />
                <span className="text-xs font-bold text-zinc-300 text-center leading-tight">Ayuda</span>
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Card interactive onClick={() => router.push('/sales/new')} padding="md" className="bg-white/5 border-white/20">
              <div className="flex flex-col items-center gap-2 py-2">
                <ShoppingBag size={26} className="text-white" />
                <span className="text-xs font-bold text-white text-center leading-tight">Nueva Venta</span>
              </div>
            </Card>
            <Card interactive onClick={() => router.push('/inventory')} padding="md">
              <div className="flex flex-col items-center gap-2 py-2">
                <Package size={26} className="text-zinc-400" />
                <span className="text-xs font-bold text-zinc-300 text-center leading-tight">Inventario</span>
              </div>
            </Card>
            <Card interactive onClick={() => router.push('/warehouses')} padding="md">
              <div className="flex flex-col items-center gap-2 py-2">
                <Warehouse size={26} className="text-zinc-400" />
                <span className="text-xs font-bold text-zinc-300 text-center leading-tight">Almacenes</span>
              </div>
            </Card>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
