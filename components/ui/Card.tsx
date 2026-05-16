import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

export default function Card({ children, className, onClick, interactive = false, padding = 'md' }: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  }

  if (interactive || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full text-left bg-zinc-900 border border-zinc-800 rounded-2xl',
          'active:scale-[0.98] hover:border-zinc-700 transition-all duration-100',
          paddings[padding],
          className
        )}
      >
        {children}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'bg-zinc-900 border border-zinc-800 rounded-2xl',
        paddings[padding],
        className
      )}
    >
      {children}
    </div>
  )
}
