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

const adminNav = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Inicio' },
  { href: '/inventory', icon: Package, label: 'Stock' },
  { href: '/sales/new', icon: ShoppingCart, label: 'Vender', primary: true },
  { href: '/sales/history', icon: Clock, label: 'Ventas' },
  { href: '/settings', icon: Settings, label: 'Config' },
]

const saleModeNav = [
  { href: '/sales/new', icon: ShoppingCart, label: 'TPV', primary: true },
  { href: '/sales/history', icon: Clock, label: 'Ventas hoy' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { isSaleMode } = useAppStore()
  const nav = isSaleMode ? saleModeNav : adminNav

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 safe-bottom">
      <div className="flex items-center justify-around px-1 pt-1 pb-2">
        {nav.map(({ href, icon: Icon, label, primary }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center gap-0.5 min-w-[52px] py-1 px-2 rounded-xl transition-all duration-150',
                primary
                  ? cn(
                      'bg-white text-black -mt-4 rounded-2xl px-5 py-2 shadow-lg shadow-white/10',
                      active && 'bg-zinc-100'
                    )
                  : cn(
                      'text-zinc-500 hover:text-zinc-300',
                      active && 'text-white'
                    )
              )}
            >
              <Icon size={primary ? 24 : 20} strokeWidth={primary ? 2.5 : active ? 2.5 : 1.5} />
              <span className={cn('text-[10px] font-medium', primary ? 'text-black' : '')}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
