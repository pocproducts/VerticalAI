import { ReactNode } from 'react'
import Link from 'next/link'

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar de navegación */}
      <aside className="w-64 border-r p-4 space-y-2">
        <h2 className="font-semibold text-lg mb-4">Settings</h2>
        <nav className="flex flex-col gap-1">
          <Link href="/profile" className="rounded-lg px-3 py-2 hover:bg-muted transition-colors">
            Profile
          </Link>
          <Link href="/profile/settings" className="rounded-lg px-3 py-2 hover:bg-muted transition-colors">
            Settings
          </Link>
        </nav>
      </aside>
      {/* Main content */}
      <main className="flex-1 p-6">
        {children}
      </main>
    </div>
  )
}
