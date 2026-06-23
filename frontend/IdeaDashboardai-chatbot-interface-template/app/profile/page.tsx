'use client'

import { useUser } from '@clerk/nextjs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function ProfilePage() {
  const { user, isLoaded } = useUser()

  if (!isLoaded) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-60" />
          </div>
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <p className="text-muted-foreground text-lg">Not signed in</p>
      </div>
    )
  }

  const initials = (user.fullName || user.emailAddresses?.[0]?.emailAddress || 'U')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user.imageUrl} alt={user.fullName || ''} />
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-semibold">
            {user.fullName || user.username || 'User'}
          </h1>
          <p className="text-muted-foreground text-sm">
            {user.emailAddresses?.[0]?.emailAddress || ''}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="secondary">Free Plan</Badge>
          </div>
        </div>
      </div>

      {/* Tenant info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">User ID</span>
            <span className="font-mono text-xs">{user.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user.emailAddresses?.[0]?.emailAddress || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Username</span>
            <span>{user.username || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Plan</span>
            <Badge variant="outline">Free</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
