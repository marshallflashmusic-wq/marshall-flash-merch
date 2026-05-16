import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
  suffix?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(({
  className,
  label,
  error,
  icon,
  suffix,
  ...props
}, ref) => {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {icon && (
          <span className="absolute left-3 text-zinc-500 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white',
            'placeholder:text-zinc-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white/20',
            'transition-colors duration-150',
            icon && 'pl-10',
            suffix && 'pr-10',
            error && 'border-red-500 focus:border-red-500 focus:ring-red-500/50',
            className
          )}
          {...props}
        />
        {suffix && (
          <span className="absolute right-3 text-zinc-500">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  )
})

Input.displayName = 'Input'
export default Input
