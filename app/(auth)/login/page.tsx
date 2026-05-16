'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAppStore } from '@/store/appStore'
import { Zap, Lock, Mail, Eye, EyeOff, Music2, ChevronDown } from 'lucide-react'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'

export default function LoginPage() {
  const router = useRouter()
  const { setSaleMode } = useAppStore()
  const [showAdminForm, setShowAdminForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Modo Venta: acceso directo al TPV sin ningún login
  const handleSaleMode = () => {
    setSaleMode(true)
    router.push('/sales/new')
  }

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        setError('Email o contraseña incorrectos')
      } else {
        setSaleMode(false)
        router.push('/dashboard')
        router.refresh()
      }
    } catch {
      setError('Error de conexión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center p-5">
      <div className="w-full max-w-sm flex flex-col gap-5">

        {/* Branding */}
        <div className="flex flex-col items-center mb-2">
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-white/10">
            <Music2 size={32} className="text-black" strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight">Marshall Flash</h1>
          <p className="text-zinc-600 text-xs mt-0.5">Merch POS</p>
        </div>

        {/* MODO VENTA — botón principal, sin login */}
        <button
          onClick={handleSaleMode}
          className="w-full bg-white hover:bg-zinc-100 active:bg-zinc-200 rounded-3xl p-7 flex flex-col items-center gap-3 transition-all duration-100 tap-scale shadow-2xl shadow-white/10"
        >
          <Zap size={44} className="text-black" strokeWidth={2.5} fill="currentColor" />
          <div className="text-center">
            <p className="text-black text-2xl font-black tracking-tight leading-none">MODO VENTA</p>
            <p className="text-black/60 text-sm font-medium mt-1">Acceso directo al TPV</p>
          </div>
        </button>

        {/* Acceso Admin — colapsable */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setShowAdminForm(v => !v)}
            className="flex items-center justify-center gap-2 py-2.5 text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
          >
            <Lock size={14} />
            <span>Acceso administrador</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${showAdminForm ? 'rotate-180' : ''}`}
            />
          </button>

          {showAdminForm && (
            <form onSubmit={handleAdminLogin} className="flex flex-col gap-3 bg-zinc-900 border border-zinc-800 rounded-2xl p-4 fade-in">
              <Input
                type="email"
                placeholder="admin@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                icon={<Mail size={16} />}
                required
                autoComplete="email"
              />
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                icon={<Lock size={16} />}
                suffix={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-zinc-500 hover:text-zinc-300 p-1"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
                required
                autoComplete="current-password"
              />
              {error && (
                <p className="text-red-400 text-xs text-center bg-red-950/50 border border-red-900 rounded-xl py-2">{error}</p>
              )}
              <Button type="submit" fullWidth loading={loading} variant="secondary">
                Entrar como admin
              </Button>
            </form>
          )}
        </div>

      </div>
    </div>
  )
}
