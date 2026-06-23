'use client'

import { useEffect, useState } from 'react'
import useApiKeys from '../../hooks/useApiKeys'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog'

export default function ApiKeysList() {
  const { keys, loading, error, listKeys, revokeKey } = useApiKeys()
  const [revokingId, setRevokingId] = useState(null)

  useEffect(() => {
    listKeys()
  }, [listKeys])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={listKeys}>
          Retry
        </Button>
      </div>
    )
  }

  if (!keys.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">No API keys yet</p>
        <p className="text-muted-foreground text-xs">
          Create your first API key to get started.
        </p>
      </div>
    )
  }

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId)
    try {
      await revokeKey(keyId)
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key Preview</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Created At</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((key: any) => (
          <TableRow key={key.id}>
            <TableCell className="font-mono text-xs">
              {key.preview || `${key.id?.slice(0, 8)}...`}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {(key.scopes || []).map((scope: string) => (
                  <Badge key={scope} variant="secondary">
                    {scope}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground text-xs">
              {key.createdAt
                ? new Date(key.createdAt).toLocaleDateString()
                : '—'}
            </TableCell>
            <TableCell className="text-right">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokingId === key.id}
                  >
                    {revokingId === key.id ? 'Revoking...' : 'Revoke'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. The key{' '}
                      <span className="font-mono font-medium">
                        {key.preview || key.id}
                      </span>{' '}
                      will stop working immediately.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => handleRevoke(key.id)}>
                      Revoke
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
