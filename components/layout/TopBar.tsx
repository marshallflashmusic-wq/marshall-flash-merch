'use client'
import { Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { cn } from '@/lib/utils'
import AdminHelpBell from '@/components/layout/AdminHelpBell'

interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  back?: React.ReactNode
}

export default function TopBar({ title, subtitle, actions, back }: TopBarProps) {
  const { isOnline, pendingSyncCount } = useAppStore()

  return (
    <header className="flex items-center gap-3 px-4 py-3 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800 safe-top shrink-0">
      {back}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-bold text-white truncate">{title}</h1>
        {subtitle && (
          <p className="text-xs text-zinc-500 truncate">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {pendingSyncCount > 0 && (
          <div className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full px-2 py-0.5">
            <RefreshCw size={12} className="text-white animate-spin" />
            <span className="text-white text-xs font-medium">{pendingSyncCount}</span>
          </div>
        )}
        <div className={cn(
          'flex items-center gap-1 rounded-full px-2 py-1',
          isOnline ? 'text-green-500' : 'text-red-500'
        )}>
          {isOnline
            ? <Wifi size={14} />
            : <WifiOff size={14} />
          }
        </div>
        {/* Campana de avisos TPV (solo se renderiza para admin) */}
        <AdminHelpBell />
        {actions}
      </div>
    </header>
  )
}
