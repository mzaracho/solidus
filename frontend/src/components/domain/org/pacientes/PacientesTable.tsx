'use client'

import { useState, useEffect } from 'react'
import { columns, PacienteSession } from './columns'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { WorkItemForm } from '@/components/domain/workload/form/WorkItemForm'
import { PaymentRegistrationModal } from '@/components/domain/payment/PaymentRegistrationModal'
import { SmartFilterBar } from '@/components/domain/shared/SmartFilterBar'
import { Plus, CreditCard } from 'lucide-react'
import { getWorkItems, getFeeRules, createWorkItem } from '@/services/data'

import { useParams } from 'next/navigation'
import { PAYMENT_STATUS } from '@/lib/constants'

export function PacientesTable() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    const [loading, setLoading] = useState(true)
    const [localData, setLocalData] = useState<PacienteSession[]>([])
    const [rules, setRules] = useState<any>(null)

    // UI State
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
    const [rowSelection, setRowSelection] = useState({})

    // Filters
    const [filters, setFilters] = useState({
        patient: '',
        status: '',
        startDate: '',
        endDate: '',
        type: '',
        method: ''
    })

    // Load Data
    useEffect(() => {
        const load = async () => {
            if (!orgSlug) return
            setLoading(true)
            const [items, rulesData] = await Promise.all([
                getWorkItems(orgSlug, 'ORGANIZATION'),
                getFeeRules(orgSlug, 'ORGANIZATION')
            ])

            // Map raw items to Table Type
            const mapped = items.map((i: any) => ({
                id: i.id.toString(),
                date: new Date(i.date),
                patientName: i.patient,
                professionalName: i.professional,
                paymentDate: i.paymentDate
                    ? new Date(i.paymentDate.substring(0, 10) + 'T12:00:00')
                    : new Date(i.date + 'T12:00:00'),
                sessionValue: i.gross,
                professionalSplit: 0.70, // In real app, derived from rules
                paid: i.paid, // Ensure this exists in type
                paymentMethod: i.paymentMethod,
                type: i.type
            }))

            setLocalData(mapped)
            setRules(rulesData)
            setLoading(false)
        }
        load()
    }, [orgSlug])

    // --- FILTERING LOGIC ---
    const filteredData = localData.filter(item => {
        // 1. Patient
        if (filters.patient && !item.patientName.toLowerCase().includes(filters.patient.toLowerCase())) return false

        // 2. Status
        if (filters.status) {
            const isPaid = item.paid
            if (filters.status === PAYMENT_STATUS.PAID && !isPaid) return false
            if (filters.status === PAYMENT_STATUS.UNPAID && isPaid) return false
        }

        // 3. Date
        if (filters.startDate && item.date < new Date(filters.startDate)) return false
        if (filters.endDate && item.date > new Date(filters.endDate)) return false

        // 4. Org Specifics
        if (filters.type && item.type !== filters.type) return false
        if (filters.method && item.paymentMethod !== filters.method) return false

        return true
    })

    const handleNewEntry = async (entries: any[]) => {
        // Create in Backend (Mock)
        await createWorkItem(orgSlug, entries)

        // Optimistic Update
        const newItems: PacienteSession[] = entries.map(entry => ({
            id: Math.random().toString(),
            date: new Date(entry.date),
            patientName: entry.patient,
            professionalName: entry.professional,
            paymentDate: new Date(),
            sessionValue: entry.gross,
            professionalSplit: 0.70,
            paid: entry.paid,
            paymentMethod: entry.paymentMethod,
            type: entry.type
        }))
        setLocalData([...newItems, ...localData])
        setIsFormOpen(false)
    }

    // Unique values for dropdowns
    const uniqueTypes = [...new Set(localData.map(d => d.type))]
    const uniqueMethods = [...new Set(localData.map(d => d.paymentMethod).filter(Boolean))] as string[]

    const selectedCount = Object.keys(rowSelection).length

    const getItemsToPay = () => {
        return filteredData // Use filtered data because indices match visible rows
            .filter((_, index) => rowSelection[index as keyof typeof rowSelection])
            .map(item => ({
                id: item.id,
                patient: item.patientName,
                gross: item.sessionValue,
                hours: 1
            }))
    }

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando datos...</div>

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <h3 className="text-lg font-medium">Registro de Sesiones</h3>
                    {selectedCount > 0 && (
                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-4">
                            <span className="text-sm text-muted-foreground">{selectedCount} seleccionados</span>
                            <Button size="sm" variant="default" onClick={() => setIsPaymentModalOpen(true)}>
                                <CreditCard className="mr-2 h-4 w-4" /> Registrar Cobro
                            </Button>
                        </div>
                    )}
                </div>
                <Button onClick={() => setIsFormOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Nueva Sesión
                </Button>
            </div>

            <SmartFilterBar
                filters={filters}
                setFilters={setFilters}
                mode="ORGANIZATION"
                uniqueTypes={uniqueTypes}
                uniqueMethods={uniqueMethods}
            />

            <DataTable
                columns={columns}
                data={filteredData}
                rowSelection={rowSelection}
                setRowSelection={setRowSelection}
            />

            <WorkItemForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                onSubmit={handleNewEntry}
                orgSlug={orgSlug}
                rulesOrg={rules}
                rulesPro={{}}
            />

            <PaymentRegistrationModal
                isOpen={isPaymentModalOpen}
                onClose={() => setIsPaymentModalOpen(false)}
                onConfirm={(items) => { console.log("Pay", items); setIsPaymentModalOpen(false); setRowSelection({}) }}
                items={getItemsToPay()}
                rulesOrg={rules}
            />
        </div>
    )
}
