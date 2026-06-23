# UI Patterns — Profile, API Keys, Settings

> Reference guide for frontend component patterns using existing shadcn/ui primitives.

## Layout Pattern

All `/profile/*` pages MUST use a sidebar navigation + main content area layout.

```
┌─────────────┬──────────────────────────────────────┐
│  Sidebar    │  Main Content Area                    │
│             │                                      │
│  ● Profile  │  (section content renders here)      │
│  ○ API Keys │                                      │
│  ○ Settings │                                      │
│             │                                      │
└─────────────┴──────────────────────────────────────┘
```

- Sidebar: vertical nav with icons, `active` state via Shadcn `navigation-menu` or custom `NavLink`
- Active section MUST be highlighted
- Layout MUST be responsive: sidebar collapses to top tabs on mobile (<768px)

## Component Patterns

### Profile Section (`/profile`)

| Element | Shadcn Component | Behavior |
|---------|-----------------|----------|
| Avatar + name | `Avatar` + `AvatarImage` from Clerk `useUser()` | Read-only |
| Email | `Card` with `p` text | Read-only |
| Tenant name | `Card` with label-value pairs | Read-only |
| Plan badge | `Badge` variant="secondary" | Shows plan name |

### API Keys Section (`/profile/api-keys`)

| Element | Shadcn Component | Behavior |
|---------|-----------------|----------|
| Create button | `Button` variant="default" | Opens `Dialog` |
| Key list | `Table` | Columns: key_preview, scopes, created_at, actions |
| Create dialog | `Dialog` | Form with scope checkboxes + Submit |
| Revoke action | `Button` variant="destructive" inside `AlertDialog` | Confirmation before revoke |
| Empty state | `Card` with icon + "No API keys yet" | CTA button "Create your first key" |

### Settings Section (`/profile/settings`)

| Element | Shadcn Component | Behavior |
|---------|-----------------|----------|
| Tenant info | `Card` with `Input` (read-only) | tenant_id, name |
| Plan info | `Badge` | Current plan, read-only |

## States Matrix

| Component | Loading | Empty | Error |
|-----------|---------|-------|-------|
| **ProfileCard** | `Skeleton` block (avatar + 3 lines) | N/A | Error message with retry `Button` |
| **ApiKeysList** | `Skeleton` table (3 rows) | Empty state `Card` with CTA | Error message with retry `Button` |
| **ApiKeyCreateDialog** | Submit `Button` disabled + spinner | N/A | Inline `p` error text in dialog |
| **SettingsPanel** | `Skeleton` form (2 fields) | N/A | Error message with retry `Button` |

## Data Fetching Pattern

All sections MUST use a consistent pattern for data fetching:

```
Component mount → loading=true → fetch data → loading=false
                                      ↓
                               error? → show error state
                               data?  → render component
                               empty? → show empty state
```

- Use a shared `useAsyncData` hook or inline `useEffect` + `useState` triplet
- Error boundaries per section (not page-level): each section catches its own errors
- Optimistic updates SHOULD NOT be used for API key operations (security-sensitive)
