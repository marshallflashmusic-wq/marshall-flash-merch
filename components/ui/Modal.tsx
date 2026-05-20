'use client'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'full'
  showClose?: boolean
}

export default function Modal({ open, onClose, title, children, size = 'md', showClose = true }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    full: 'max-w-full mx-2',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className={cn(
          'relative w-full bg-zinc-900 border border-zinc-800 shadow-2xl slide-up flex flex-col',
          'rounded-t-3xl sm:rounded-3xl',
          // Altura máxima para que NUNCA se salga del viewport en móvil
          'max-h-[92vh] sm:max-h-[85vh]',
          sizes[size]
        )}
        onClick={e => e.stopPropagation()}
      >
        {(title || showClose) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            {title && <h2 className="text-base font-bold text-white">{title}</h2>}
            {showClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 ml-auto"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="px-4 py-4 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}
