'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Clock,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/appStore'

// 7 items con Vender (primary) en posición 4 → queda centrado en el bottom nav.
const adminNav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Inicio' },
  { href: '/inventory', icon: Package, label: 'Stock' },
  { href: '/sales/new', icon: ShoppingCart, label: 'Vender', primary: true },
  { href: '/sales/history', icon: Clock, label: 'Ventas' },
  { href: '/settings', icon: Settings, label: 'Config' },
]

const saleModeNav = [
  { href: '/sales/new', icon: ShoppingCart, label: 'TPV' },
  { href: '/sales/history', icon: Clock, label: 'Historial' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { isSaleMode } = useAppStore()
  const nav = isSaleMode ? saleModeNav : adminNav

  if (isSaleMode) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 safe-bottom">
        <div className="flex items-center justify-around gap-3 px-4 py-2">
          {nav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center gap-1 py-2 rounded-2xl border transition-all duration-150',
                  active
                    ? 'border-white bg-white/10 text-white shadow-lg shadow-white/10'
                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                )}
              >
                <Icon size={22} strokeWidth={2.5} />
                <span className="text-[11px] font-semibold">{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    )
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 safe-bottom">
      <div className="flex items-end justify-around px-1 pt-1 pb-2">
        {adminNav.map(({ href, icon: Icon, label, primary }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 min-w-[52px] py-1 px-2 rounded-xl transition-all duration-150',
                primary
                  ? cn(
                      'bg-green-500 text-white -mt-4 rounded-2xl px-5 py-2 shadow-lg shadow-green-500/30 border-0',
                      active && 'bg-green-400'
                    )
                  : cn(
                      'border',
                      active
                        ? 'border-white text-white bg-white/10'
                        : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                    )
              )}
            >
              <Icon size={primary ? 24 : 20} strokeWidth={primary ? 2.5 : active ? 2.5 : 1.5} />
              <span className={cn(
                'text-[10px] font-medium',
                primary ? 'text-white' : active ? 'text-white font-semibold' : ''
              )}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
