import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User, Event } from '@/types'

interface TpvSessionState {
  id: string
  sellerName: string
  expiresAt: string
}

interface AppStore {
  user: User | null
  activeEvent: Event | null
  isOnline: boolean
  pendingSyncCount: number
  isSaleMode: boolean
  tpvSession: TpvSessionState | null
  setUser: (user: User | null) => void
  setActiveEvent: (event: Event | null) => void
  setIsOnline: (online: boolean) => void
  setPendingSyncCount: (count: number) => void
  setSaleMode: (value: boolean) => void
  setTpvSession: (session: TpvSessionState | null) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user: null,
      activeEvent: null,
      isOnline: true,
      pendingSyncCount: 0,
      isSaleMode: false,
      tpvSession: null,
      setUser: (user) => set({ user }),
      setActiveEvent: (event) => set({ activeEvent: event }),
      setIsOnline: (isOnline) => set({ isOnline }),
      setPendingSyncCount: (pendingSyncCount) => set({ pendingSyncCount }),
      setSaleMode: (isSaleMode) => set({ isSaleMode }),
      setTpvSession: (tpvSession) => set({ tpvSession }),
    }),
    {
      name: 'marshall-flash-app',
      partialize: (state) => ({
        user: state.user,
        activeEvent: state.activeEvent,
        isSaleMode: state.isSaleMode,
        tpvSession: state.tpvSession,
      }),
    }
  )
)
