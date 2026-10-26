'use client'

import Link from 'next/link'
import { usePathname, useRouter, useParams } from 'next/navigation'
import { LayoutGrid, BarChart3, Settings, Calculator, User, Banknote, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store/useStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useEffect, useState } from 'react'

function getNameFromToken(): string {
    try {
        const match = document.cookie.match(/(^| )auth_token=([^;]+)/)
        if (!match) return 'Usuario'
        const payload = JSON.parse(atob(match[2].split('.')[1]))
        return payload.name || payload.email || 'Usuario'
    } catch {
        return 'Usuario'
    }
}

export function Sidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const params = useParams()
    const { orgSlug: storeOrgSlug, userRole, viewMode, setRole, setViewMode, availableRoles, orgRole, setOrgSlug } = useStore()
    const orgSlug = (params?.orgSlug as string) || storeOrgSlug || ''

    useEffect(() => {
        if (params?.orgSlug && params.orgSlug !== storeOrgSlug) {
            setOrgSlug(params.orgSlug as string)
        }
    }, [params?.orgSlug, storeOrgSlug, setOrgSlug])

    const userName = typeof document !== 'undefined' ? getNameFromToken() : 'Usuario'

    const handleLogout = () => {
        document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
        window.location.href = '/login'
    }

    const orgLinks = [
        { href: `/${orgSlug}/dashboard`, label: 'Dashboard', icon: BarChart3, restricted: true },
        { href: `/${orgSlug}/org/admisiones`, label: 'Carga & Seguimiento', icon: LayoutGrid, restricted: false },
        { href: `/${orgSlug}/org/liquidaciones`, label: 'Liquidaciones', icon: Banknote, restricted: true },
        { href: `/${orgSlug}/org/profesionales`, label: 'Gestión de Profesionales', icon: User, restricted: false },
        { href: `/${orgSlug}/patients`, label: 'Gestión de Pacientes', icon: User, restricted: false },
        { href: `/${orgSlug}/settings/categories`, label: 'Reglas de Honorarios', icon: Calculator, restricted: true },
        { href: `/${orgSlug}/settings/general`, label: 'Ajustes Generales', icon: Settings, restricted: true },
    ]

    const [canLoadActivities, setCanLoadActivities] = useState<boolean | null>(null)

    useEffect(() => {
        if (!storeOrgSlug || viewMode !== 'PROFESSIONAL') return
        import('@/services/data').then(({ getProfessionalContext }) => {
            getProfessionalContext(storeOrgSlug).then(ctx => {
                setCanLoadActivities(ctx?.canLoadActivities ?? false)
            })
        })
    }, [storeOrgSlug, viewMode])

    const proLinks = [
        { href: `/${orgSlug}/dashboard`, label: 'Dashboard', icon: BarChart3, restricted: false },
        { href: `/${orgSlug}/pro/atenciones`, label: 'Carga & Seguimiento', icon: LayoutGrid, restricted: false },
        { href: `/${orgSlug}/patients`, label: 'Gestión de Pacientes', icon: User, restricted: false },
        { href: `/${orgSlug}/settings/fees`, label: 'Reglas de Honorarios', icon: Calculator, restricted: false },
        { href: `/${orgSlug}/settings/general`, label: 'Ajustes Generales', icon: Settings, restricted: false },
    ]

    const links = viewMode === 'ORGANIZATION' ? orgLinks : proLinks

    // Redirect Logic for MEMBER — applies in both org and pro modes
    useEffect(() => {
        if (orgRole !== 'MEMBER') return
        const currentLinks = viewMode === 'ORGANIZATION' ? orgLinks : proLinks
        const isRestricted = currentLinks.some(link => link.restricted && pathname.startsWith(link.href))
        if (isRestricted) {
            // Use slug from current URL path (store orgSlug may be empty)
            const slugFromPath = pathname.split('/')[1] || orgSlug
            const fallback = viewMode === 'ORGANIZATION' ? `/${slugFromPath}/org/admisiones` : `/${slugFromPath}/pro/atenciones`
            router.push(fallback)
        }
    }, [pathname, orgRole, viewMode, orgSlug, router])

    // Auto-switch ViewMode if only one role is available
    useEffect(() => {
        if (availableRoles.length === 1) {
            const soleRole = availableRoles[0].code as 'ORGANIZATION' | 'PROFESSIONAL'
            if (viewMode !== soleRole) {
                setViewMode(soleRole)
            }
        }
    }, [availableRoles, viewMode, setViewMode])

    return (
        <div className="flex h-screen w-64 flex-col border-r bg-muted/10">
            <div className="flex h-14 items-center border-b px-6 font-semibold">
                <span className="text-lg tracking-tight text-primary">Solidus</span>
                <Badge variant="secondary" className="ml-2 text-[10px] uppercase">
                    {viewMode === 'ORGANIZATION' ? 'Org' : 'Pro'}
                </Badge>
            </div>

            <div className="flex-1 py-4">
                <nav className="space-y-1 px-3">
                    {links.map((link) => {
                        // Permissions Check — hide restricted links for MEMBER in any mode
                        if (orgRole === 'MEMBER' && (link as any).restricted) {
                            return null;
                        }

                        const isActive = pathname.startsWith(link.href)
                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={cn(
                                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                                    isActive
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                )}
                            >
                                <link.icon className="h-4 w-4" />
                                <span className="truncate">{link.label}</span>
                            </Link>
                        )
                    })}
                </nav>
            </div>

            <div className="border-t p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center justify-between">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="relative h-12 w-full justify-start gap-2 px-2 hover:bg-muted">
                                    <User className="h-8 w-8 rounded-full bg-muted p-1" />
                                    <div className="flex flex-col items-start text-xs">
                                        <p className="font-medium text-foreground">{userName}</p>
                                        <span className="text-[10px] text-muted-foreground">
                                            Modo: {viewMode === 'ORGANIZATION'
                                                ? (availableRoles.find(r => r.code === 'ORGANIZATION')?.name || 'Organización')
                                                : (availableRoles.find(r => r.code === 'PROFESSIONAL')?.name || 'Profesional')}
                                        </span>
                                    </div>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                {availableRoles.length > 1 && (
                                    <>
                                        {availableRoles.find(r => r.code === 'ORGANIZATION') && (
                                            <DropdownMenuItem onClick={() => setViewMode('ORGANIZATION')}>
                                                Ver como {availableRoles.find(r => r.code === 'ORGANIZATION')?.name || 'Organización'}
                                            </DropdownMenuItem>
                                        )}
                                        {availableRoles.find(r => r.code === 'PROFESSIONAL') && (
                                            <DropdownMenuItem onClick={() => setViewMode('PROFESSIONAL')}>
                                                Ver como {availableRoles.find(r => r.code === 'PROFESSIONAL')?.name || 'Profesional'}
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                    </>
                                )}
                                <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:text-red-500">
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Cerrar Sesión
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>
            {/* 
                   Hidden as per user request to avoid confusion. 
                   Org Role is now handled by internal permissions (MEMBER vs ADMIN) 
                */}
        </div>
    )
}
