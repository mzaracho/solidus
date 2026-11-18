'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from 'sonner'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { SESSION_MESSAGES } from '@/lib/constants'
import { registerApiForbiddenNotifier } from '@/services/data'

function ForbiddenNotifier() {
    // data.ts no importa sonner (también se usa desde el servidor): el toast de 403 se registra acá.
    useEffect(() => {
        registerApiForbiddenNotifier(() => {
            toast.error(SESSION_MESSAGES.forbiddenAction, { id: 'api-forbidden' })
        })
        return () => registerApiForbiddenNotifier(null)
    }, [])

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
                <ForbiddenNotifier />
                {children}
                <Toaster />
            </TooltipProvider>
        </QueryClientProvider>
    )
}
