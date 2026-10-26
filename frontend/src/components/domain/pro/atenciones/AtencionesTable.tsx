'use client'

import { useState, useEffect } from 'react'
import { getColumns, Attention } from './columns'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { WorkItemForm } from '@/components/domain/workload/form/WorkItemForm'
import { AttendanceModal } from './AttendanceModal'
import { ActivityDetailModal } from './ActivityDetailModal'
import { PaymentRegistrationModal } from '@/components/domain/payment/PaymentRegistrationModal'
import { SmartFilterBar } from '@/components/domain/shared/SmartFilterBar'
import { Plus, CreditCard } from 'lucide-react'
import { getWorkItems, getFeeRules, createWorkItem, deleteWorkItem, updateWorkItem, getPayers, getOrgConfig, getProfessionalMemberships } from '@/services/data'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'

import { useParams, useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { PAYMENT_STATUS, ATTENDANCE, DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, PAYER_PARTICULAR } from '@/lib/constants'

type Props = {
    canLoadActivities?: boolean
    currentUserId?: string | null
}

export function AtencionesTable({ canLoadActivities = false, currentUserId }: Props) {
    const params = useParams()
    const router = useRouter()
    const orgSlug = params.orgSlug as string

    const [loading, setLoading] = useState(true)
    const [localData, setLocalData] = useState<Attention[]>([])
    const [rawData, setRawData] = useState<any[]>([])
    const [rules, setRules] = useState<any>(null)
    const [orgConfig, setOrgConfig] = useState<any>(null)
    const [memberships, setMemberships] = useState<any[]>([])

    const [isFormOpen, setIsFormOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<any>(null)
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)

    // Attendance Modal State
    const [isAttendanceModalOpen, setIsAttendanceModalOpen] = useState(false)
    const [attendanceItem, setAttendanceItem] = useState<Attention | null>(null)

    const [rowSelection, setRowSelection] = useState({})
    const [confirmDelete, setConfirmDelete] = useState<Attention | null>(null)

    // State for single-item actions
    const [itemToPay, setItemToPay] = useState<Attention | null>(null)
    const [detailItem, setDetailItem] = useState<any | null>(null)

    // Filters
    const [filters, setFilters] = useState({
        patient: '',
        status: '',
        startDate: '',
        endDate: '',
        payer: ''
    })

    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE)
    const [refreshKey, setRefreshKey] = useState(0)

    // Load Data
    useEffect(() => {
        const load = async () => {
            if (!orgSlug) return
            setLoading(true)

            // Allow backend to handle filtering
            const [data, rulesData, payersData, orgConfigData, membershipsData] = await Promise.all([
                getWorkItems(orgSlug, 'PROFESSIONAL', filters, page, limit),
                getFeeRules(orgSlug, 'PROFESSIONAL'),
                getPayers(orgSlug, 1, 100),
                getOrgConfig(orgSlug),
                getProfessionalMemberships(orgSlug),
            ])
            setOrgConfig(orgConfigData)
            setMemberships(membershipsData || [])

            // Handle legacy vs new response
            const items = data.items || (Array.isArray(data) ? data : [])
            const totalCount = data.total || items.length
            setTotal(totalCount)

            setRawData(items)

            // Map raw items to Table Type
            const mapped = items.map((i: any) => ({
                id: i.id.toString(),
                date: new Date(i.date + 'T12:00:00'), // Force noon to prevent timezone rollback to previous day
                patientName: i.patientName || i.patient || 'Sin Nombre', // Fix: Use patientName from API
                // Use organizationName when payer is "Particular" (system-managed) — this means the activity
                // belongs to an org where the patient pays directly (no OS/payer), so show the org name.
                // Only use payerName when it's a real payer (OS like OSDE, Swiss Medical, etc.)
                orgName: (!i.payerName || i.payerName === 'Unknown' || i.payerName === PAYER_PARTICULAR)
                    ? (i.organizationName || PAYER_PARTICULAR)
                    : i.payerName,
                fees: i.grossAmount ?? i.fees ?? 0, // Fix: Use grossAmount from API
                attended: i.attendance || ATTENDANCE.PRESENT,
                paid: i.status === PAYMENT_STATUS.PAID,
                status: i.status, // Keep result status
                commission: i.commission,
                netAmount: i.netAmount,
                paymentDate: i.paymentDate,
                createdByUserId: i.createdByUserId ?? null,
                isExternal: i.isExternal ?? false,
                organizationName: i.organizationName ?? '',
                role: i.role ?? null,
            }))

            setLocalData(mapped)
            // Fix: Merge payers into rules object for WorkItemForm
            setRules({ ...rulesData, payers: payersData?.items || [] })
            setLoading(false)
        }
        load()
    }, [orgSlug, filters, page, limit, refreshKey]) // Trigger re-fetch on filter change or page change

    const handleSave = async (entries: any[]) => {
        // If editing, entries[0] is the updated item.
        // We need to distinguish create vs update.
        // WorkItemForm returns array, but for edit we expect 1 item usually.
        // If we have editingItem, it's an update.
        try {
            if (editingItem) {
                const data = entries[0]
                await updateWorkItem(orgSlug, editingItem.id, data)
            } else {
                // Iterate and create each item individually (Backend expects single object)
                for (const entry of entries) {
                    await createWorkItem(orgSlug, entry)
                }
            }

            // Refresh Current Page
            setRefreshKey(k => k + 1)
            router.refresh()
        } catch (error: any) {
            const msg = error?.message || 'Error al guardar la actividad'
            toast.error(msg)
            // Re-throw so WorkItemForm can also react if needed
            throw error
        }
    }

    const handleEdit = (item: Attention) => {
        // Find raw item
        const raw = rawData.find(r => r.id === item.id)
        if (raw) {
            setEditingItem(raw)
            setIsFormOpen(true)
        }
    }

    const handleDelete = (item: Attention) => {
        setConfirmDelete(item)
    }

    const doDelete = async (item: Attention) => {
        const raw = rawData.find(r => r.id === item.id)
        if (raw) {
            await deleteWorkItem(orgSlug, raw.id)
            router.refresh()
        }
    }

    const handleMarkPaid = (item: Attention) => {
        setItemToPay(item)
        setIsPaymentModalOpen(true)
    }

    // Filter Logic (Client-side search for some fields if needed, but we rely on backend mainly)
    const filteredData = localData

    const handleUpdateAttendance = async (status: string) => {
        if (!attendanceItem) return
        await updateWorkItem(orgSlug, attendanceItem.id, { attendance: status })
        setIsAttendanceModalOpen(false)
        setAttendanceItem(null)
        router.refresh()
    }

    const columns = useMemo(() => getColumns(
        handleMarkPaid,
        handleDelete,
        handleEdit,
        (item) => {
            setAttendanceItem(item)
            setIsAttendanceModalOpen(true)
        },
        currentUserId ?? null,
        (item) => {
            const raw = rawData.find(r => r.id === item.id)
            setDetailItem(raw || item)
        },
    ), [orgSlug, rawData, currentUserId])

    const uniquePayers = useMemo(() => {
        const payers = new Map();
        // Use rules.payers if available for dropdown
        if (rules?.payers) {
            return rules.payers;
        }
        return [];
    }, [rules]);

    // Payment Logic
    const selectedCount = Object.keys(rowSelection).length
    const getItemsToPay = () => {
        // If we are paying a single item via action button
        if (itemToPay) {
            return [{
                id: itemToPay.id,
                patient: itemToPay.patientName,
                gross: itemToPay.fees,
                presetId: 'custom',
            }]
        }

        // Bulk selection
        return filteredData
            .filter((_, index) => rowSelection[index as keyof typeof rowSelection])
            .map(item => ({
                id: item.id,
                patient: item.patientName,
                gross: item.fees,
                presetId: 'custom',
            }))
    }

    if (loading) return <div className="p-8 text-center text-muted-foreground">Cargando datos...</div>

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">Registro Diario</h2>
                    {rules?.kpi && (
                        <div className="flex space-x-4 text-sm text-muted-foreground mt-1">
                            <span>Pendiente: ${rules.kpi.pending.toLocaleString()}</span>
                            <span>Cobrado: ${rules.kpi.cashGross.toLocaleString()}</span>
                        </div>
                    )}
                </div>
                {canLoadActivities && (
                    <Button onClick={() => { setEditingItem(null); setIsFormOpen(true) }}>
                        <Plus className="mr-2 h-4 w-4" /> Nueva Atención
                    </Button>
                )}
            </div>

            <SmartFilterBar
                filters={filters}
                setFilters={setFilters}
                mode="PROFESSIONAL"
                uniquePayers={uniquePayers}
            />

            <DataTable
                columns={columns}
                data={filteredData}
                rowSelection={rowSelection}
                setRowSelection={setRowSelection}
                hidePagination={true}
            />

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center space-x-4">
                    <div className="text-xs text-muted-foreground">
                        Mostrando {((page - 1) * limit) + 1} a {Math.min(page * limit, total)} de {total} registros
                    </div>
                    <select
                        className="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                        value={limit}
                        onChange={(e) => {
                            setLimit(Number(e.target.value));
                            setPage(1); // Reset to page 1 when limit changes
                        }}
                    >
                        {PAGE_SIZE_OPTIONS.map((pageSize) => (
                            <option key={pageSize} value={pageSize}>
                                {pageSize}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                    >
                        Anterior
                    </Button>
                    <div className="text-xs font-medium">
                        Página {page} de {Math.ceil(total / limit) || 1}
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => p + 1)}
                        disabled={page >= Math.ceil(total / limit) || loading}
                    >
                        Siguiente
                    </Button>
                </div>
            </div>

            <WorkItemForm
                isOpen={isFormOpen}
                onClose={() => { setIsFormOpen(false); setEditingItem(null) }}
                onSubmit={handleSave}
                initialData={editingItem}
                orgSlug={orgSlug}
                rulesOrg={{ 
                    values: orgConfig?.presets || [],
                    professionals: orgConfig?.staff?.map((s: any) => ({ id: s.id, name: s.displayName })) || [],
                    type: orgConfig?.type
                }}
                rulesPro={{ ...rules, memberships }}
            />

            <PaymentRegistrationModal
                isOpen={isPaymentModalOpen}
                onClose={() => { setIsPaymentModalOpen(false); setItemToPay(null) }}
                onConfirm={async (items, date, method) => {
                    for (const item of items) {
                        await updateWorkItem(orgSlug, item.id.toString(), {
                            paymentStatus: PAYMENT_STATUS.PAID,
                            paymentDate: date,
                            paymentMethod: method
                        })
                    }
                    setIsPaymentModalOpen(false)
                    setRowSelection({})
                    setItemToPay(null)
                    router.refresh()
                }}
                items={getItemsToPay()}
                rulesOrg={{}}
            />
            <AttendanceModal
                isOpen={isAttendanceModalOpen}
                onClose={() => { setIsAttendanceModalOpen(false); setAttendanceItem(null) }}
                onConfirm={handleUpdateAttendance}
                initialStatus={attendanceItem?.attended || ATTENDANCE.PRESENT}
            />
            <ConfirmDialog
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => confirmDelete && doDelete(confirmDelete)}
                title="Eliminar registro"
                description="¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />
            <ActivityDetailModal
                isOpen={!!detailItem}
                item={detailItem}
                onClose={() => setDetailItem(null)}
            />
        </div>
    )
}
