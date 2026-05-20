import BottomNav from '@/components/layout/BottomNav'
import SessionProvider from '@/components/providers/SessionProvider'
import HelpRequestsListener from '@/components/providers/HelpRequestsListener'

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex flex-col h-full bg-[#0a0a0a]">
        <main className="flex-1 overflow-hidden pb-[72px]">
          {children}
        </main>
        <BottomNav />
        <HelpRequestsListener />
      </div>
    </SessionProvider>
  )
}
