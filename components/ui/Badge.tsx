import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
  size?: 'sm' | 'md'
  className?: string
}

export default function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  const variants = {
    default: 'bg-zinc-800 text-zinc-300',
    success: 'bg-green-900/50 text-green-400 border border-green-800',
    warning: 'bg-amber-900/50 text-amber-400 border border-amber-800',
    danger: 'bg-red-900/50 text-red-400 border border-red-800',
    info: 'bg-blue-900/50 text-blue-400 border border-blue-800',
    outline: 'bg-transparent border border-zinc-700 text-zinc-400',
  }

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  }

  return (
    <span className={cn(
      'inline-flex items-center rounded-full font-medium',
      variants[variant],
      sizes[size],
      className
    )}>
      {children}
    </span>
  )
}
