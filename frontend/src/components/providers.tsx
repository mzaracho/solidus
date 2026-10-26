'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { useState, useEffect } from 'react'
import { useStore } from '@/store/useStore'
import { jwtDecode } from 'jwt-decode'

function AuthHydrator() {
    const { setAvailableRoles, setRole, setViewMode, setOrgRole } = useStore()

    useEffect(() => {
        const match = document.cookie.match(new RegExp('(^| )auth_token=([^;]+)'))
        if (match) {
            try {
                const token = match[2]
                const decoded: any = jwtDecode(token)

                // Check Expiration (exp is in seconds)
                if (decoded.exp && (decoded.exp * 1000) < Date.now()) {
                    console.warn('Token expired. Clearing session.')
                    document.cookie = 'auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;'
                    return
                }

                if (decoded && decoded.roles && Array.isArray(decoded.roles)) {
                    setAvailableRoles(decoded.roles)
                }
                if (decoded && decoded.hasOwnProperty('orgRole')) {
                    setOrgRole(decoded.orgRole)
                }
            } catch (e) {
                console.error('Failed to decode token', e)
            }
        }
    }, [setAvailableRoles, setOrgRole])

    return null
}

export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 60 * 1000,
                retry: 1,
            },
        },
    }))

    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={0}>
                <AuthHydrator />
                {children}
                <Toaster />
            </TooltipProvider>
        </QueryClientProvider>
    )
}
