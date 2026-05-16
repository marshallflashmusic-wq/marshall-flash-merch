'use client'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  loading?: boolean
  fullWidth?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  children,
  disabled,
  ...props
}, ref) => {
  const variants = {
    primary: 'bg-white hover:bg-zinc-100 active:bg-zinc-200 text-black font-bold',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-white',
    ghost: 'bg-transparent hover:bg-zinc-800 active:bg-zinc-900 text-white',
    danger: 'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold',
    success: 'bg-green-600 hover:bg-green-500 active:bg-green-700 text-white font-bold',
    outline: 'bg-transparent border border-zinc-700 hover:bg-zinc-800 text-white',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-4 py-2.5 text-sm rounded-xl',
    lg: 'px-5 py-3 text-base rounded-xl',
    xl: 'px-6 py-4 text-lg rounded-2xl',
  }

  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-all duration-100 tap-scale select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
})

Button.displayName = 'Button'
export default Button
