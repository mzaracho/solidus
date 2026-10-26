'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { ProfessionalPayouts } from '@/components/domain/org/payouts/ProfessionalPayouts'
import { calculateSettlements } from '@/services/data'

export default function LiquidacionesPage() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date()
        return now.toISOString().slice(0, 7) // YYYY-MM
    })

    const [loading, setLoading] = useState(true)
    const [payoutsData, setPayoutsData] = useState<any[]>([])

    useEffect(() => {
        const load = async () => {
            if (!orgSlug) return
            setLoading(true)

            try {
                const data = await calculateSettlements(orgSlug, selectedMonth)
                setPayoutsData(data || [])
            } catch (err) {
                console.error("Error loading settlement data", err)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [orgSlug, selectedMonth])

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Liquidaciones</h1>
                <p className="text-muted-foreground">
                    Cálculo automático de honorarios profesionales.
                </p>
            </div>

            <ProfessionalPayouts
                data={payoutsData}
                selectedMonth={selectedMonth}
                onMonthChange={setSelectedMonth}
                loading={loading}
            />
        </div>
    )
}
