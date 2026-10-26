'use client'

import { AtencionesTable } from '@/components/domain/pro/atenciones/AtencionesTable'
import { getProfessionalContext } from '@/services/data'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function AtencionesPage() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [canLoadActivities, setCanLoadActivities] = useState<boolean | null>(null)
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)

    useEffect(() => {
        if (!orgSlug) return
        getProfessionalContext(orgSlug).then(ctx => {
            if (ctx) {
                setCanLoadActivities(ctx.canLoadActivities)
                setCurrentUserId(ctx.userId ?? null)
            } else {
                setCanLoadActivities(false)
            }
        })
    }, [orgSlug])

    return (
        <div className="flex-1 space-y-4 p-8 pt-6">
            <div className="flex items-center justify-between space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">Atenciones (Diario)</h2>
            </div>
            <div className="rounded-md border p-6">
                <AtencionesTable
                    canLoadActivities={canLoadActivities ?? false}
                    currentUserId={currentUserId}
                />
            </div>
        </div>
    )
}
