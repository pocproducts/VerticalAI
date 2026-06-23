'use client'

import { useState } from 'react'
import ApiKeysList from '@/components/profile/ApiKeysList'
import ApiKeyCreateDialog from '@/components/profile/ApiKeyCreateDialog'

export default function ApiKeysPage() {
  const [showCreate, setShowCreate] = useState(false)
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">API Keys</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium"
        >
          Create API Key
        </button>
      </div>
      <ApiKeysList />
      {showCreate && <ApiKeyCreateDialog onClose={() => setShowCreate(false)} />}
    </div>
  )
}
