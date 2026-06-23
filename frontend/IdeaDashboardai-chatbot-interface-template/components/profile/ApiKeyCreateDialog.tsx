'use client'

import { useState } from 'react'
import useApiKeys from '../../hooks/useApiKeys'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { Spinner } from '../ui/spinner'

const AVAILABLE_SCOPES = [
  { id: 'chat:read', label: 'chat:read — Read conversations' },
  { id: 'chat:write', label: 'chat:write — Send messages' },
  { id: 'admin:keys', label: 'admin:keys — Manage API keys' },
  { id: 'admin:users', label: 'admin:users — Manage users' },
]

interface Props {
  onClose: () => void
}

export default function ApiKeyCreateDialog({ onClose }: Props) {
  const { createKey } = useApiKeys()
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'chat:read',
    'chat:write',
  ])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdKey, setCreatedKey] = useState<{ fullKey: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    )
  }

  async function handleSubmit() {
    if (selectedScopes.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createKey(selectedScopes)
      setCreatedKey(result)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy() {
    if (!createdKey?.fullKey) return
    try {
      await navigator.clipboard.writeText(createdKey.fullKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for older browsers
      const textarea = document.createElement('textarea')
      textarea.value = createdKey.fullKey
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function handleClose() {
    onClose()
  }

  // Step 2: show the created key
  if (createdKey) {
    return (
      <Dialog open onOpenChange={() => {}}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Save this key — it will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">⚠️ Important</p>
            <p className="mt-1">
              Copy this key now. You won&apos;t be able to see it again.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
              {createdKey.fullKey}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Step 1: scope selection form
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Select the permissions for this API key.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {AVAILABLE_SCOPES.map((scope) => (
            <div key={scope.id} className="flex items-center gap-3">
              <Checkbox
                id={scope.id}
                checked={selectedScopes.includes(scope.id)}
                onCheckedChange={() => toggleScope(scope.id)}
              />
              <Label htmlFor={scope.id} className="text-sm font-normal">
                {scope.label}
              </Label>
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || selectedScopes.length === 0}
          >
            {submitting && <Spinner className="mr-1" />}
            {submitting ? 'Creating...' : 'Create Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
