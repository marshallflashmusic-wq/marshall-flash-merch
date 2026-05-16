import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(({
  className,
  label,
  error,
  options,
  placeholder,
  ...props
}, ref) => {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-zinc-300">{label}</label>
      )}
      <select
        ref={ref}
        className={cn(
          'w-full bg-zinc-800 border border-zinc-700 rounded-xl py-3 px-4 text-white',
          'focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/50',
          'transition-colors duration-150 appearance-none cursor-pointer',
          error && 'border-red-500',
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>{placeholder}</option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} className="bg-zinc-800">
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
})

Select.displayName = 'Select'
export default Select
