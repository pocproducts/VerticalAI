'use client'

import { useUser } from '@clerk/nextjs'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card'
import { Badge } from '../ui/badge'
import { Skeleton } from '../ui/skeleton'

export default function SettingsPanel() {
  const { user, isLoaded } = useUser()

  if (!isLoaded) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-60" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Tenant Settings</CardTitle>
        <CardDescription>
          Read-only information about your account and tenant.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tenant ID</span>
          <span className="font-mono text-xs">{user?.id || '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Plan Tier</span>
          <Badge variant="outline">Free</Badge>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Created</span>
          <span className="text-xs">
            {user?.createdAt
              ? new Date(user.createdAt).toLocaleDateString()
              : '—'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
