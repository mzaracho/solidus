'use client'

import { useState, useEffect, useMemo } from 'react'
import { DataTable } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useParams } from 'next/navigation'
import { getWorkItems, getOrgConfig, createWorkItem, deleteWorkItem, updateWorkItem, getWorkItemById, getActivityTypes } from '@/services/data'
import { WorkItemForm } from '@/components/domain/workload/form/WorkItemForm'
import { ActivityDetailDialog } from './ActivityDetailDialog'
import { PaymentRegistrationModal } from '@/components/domain/payment/PaymentRegistrationModal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Plus, Eye, Pencil, Trash2, CreditCard, X } from 'lucide-react'
import { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { PAYMENT_STATUS, FILTER_ALL, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from '@/lib/constants'

// ─── Status helpers ───────────────────────────────────────────────────────────

function isPaidStatus(s: string) {
    return s === PAYMENT_STATUS.PAID
}

function StatusBadge({ status }: { status: string }) {
    if (isPaidStatus(status)) return <Badge className="bg-green-600 hover:bg-green-700 text-white">Cobrado</Badge>
    if (status === PAYMENT_STATUS.PARTIAL) return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Parcial</Badge>
    return <Badge variant="secondary">Pendiente</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdmisionesTable() {
    const params = useParams()
    const orgSlug = params.orgSlug as string

    // ── Data ──────────────────────────────────────────────────────────────────
    const [loading, setLoading] = useState(true)
    const [localData, setLocalData] = useState<any[]>([])
    const [total, setTotal] = useState(0)
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE)

    // ── Filters ───────────────────────────────────────────────────────────────
    const [filterAdmisor, setFilterAdmisor] = useState('')
    const [filterDateFrom, setFilterDateFrom] = useState('')
    const [filterDateTo, setFilterDateTo] = useState('')
    const [filterType, setFilterType] = useState(FILTER_ALL)
    const [filterStatus, setFilterStatus] = useState(FILTER_ALL)
    const [activityTypes, setActivityTypes] = useState<any[]>([])

    // ── Config / Modals ───────────────────────────────────────────────────────
    const [config, setConfig] = useState<any>({})
    const [categories, setCategories] = useState<any[]>([])
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<any>(null)
    const [isDetailOpen, setIsDetailOpen] = useState(false)
    const [detailItem, setDetailItem] = useState<any>(null)
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
    const [itemToPay, setItemToPay] = useState<any>(null)
    const [confirmDelete, setConfirmDelete] = useState<any>(null)

    // ── Load data ─────────────────────────────────────────────────────────────
    const loadData = async () => {
        setLoading(true)
        try {
            const filters: Record<string, string> = {}
            if (filterDateFrom) filters.startDate = filterDateFrom
            if (filterDateTo) filters.endDate = filterDateTo
            if (filterType && filterType !== FILTER_ALL) filters.type = filterType
            if (filterStatus && filterStatus !== FILTER_ALL) filters.status = filterStatus

            const [data, orgConfig, types] = await Promise.all([
                getWorkItems(orgSlug, 'ORGANIZATION', filters, page, limit),
                getOrgConfig(orgSlug),
                getActivityTypes(orgSlug),
            ])

            const items = data.items || (Array.isArray(data) ? data : [])
            setTotal(data.total || items.length)
            setActivityTypes(Array.isArray(types) ? types : [])

            const mapped = items.map((i: any) => ({
                id: i.id.toString(),
                id_original: i.id,
                date: new Date(i.date + 'T12:00:00'),
                patientName: i.patientName || 'Sin Nombre',
                admisorName: i.professionalName || 'Sin Profesional',
                serviceType: i.serviceType || '-',
                admissionValue: i.grossAmount ?? 0,
                paymentStatus: i.status || i.paymentStatus || PAYMENT_STATUS.UNPAID,
                paymentDate: i.paymentDate,
                paymentMethod: i.paymentMethod || null,
                fees: i.grossAmount ?? 0,
                presetId: i.presetId,
            }))

            setLocalData(mapped)
            setCategories(orgConfig?.categories || [])
            setConfig({
                professionals: orgConfig?.staff?.map((s: any) => ({ id: s.id, name: s.displayName })) || [],
                values: orgConfig?.presets || [],
            })
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { if (orgSlug) loadData() }, [orgSlug, page, limit])

    // Re-fetch from page 1 when filters change
    useEffect(() => {
        if (!orgSlug) return
        setPage(1)
        loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterDateFrom, filterDateTo, filterType, filterStatus])

    // ── Handlers ──────────────────────────────────────────────────────────────
    const handleSave = async (entries: any[]) => {
        if (editingItem) {
            await updateWorkItem(orgSlug, editingItem.id, entries[0])
        } else {
            for (const entry of entries) {
                await createWorkItem(orgSlug, { ...entry, mode: 'org' })
            }
        }
        setIsFormOpen(false)
        setEditingItem(null)
        loadData()
    }

    const handleView = async (item: any) => {
        try {
            const detail = await getWorkItemById(orgSlug, item.id_original || item.id)
            setDetailItem(detail || item)
        } catch {
            setDetailItem(item)
        }
        setIsDetailOpen(true)
    }

    const handleEdit = async (item: any) => {
        try {
            const detail = await getWorkItemById(orgSlug, item.id_original || item.id)
            setEditingItem(detail || { ...item, id: item.id_original || item.id })
        } catch {
            setEditingItem({ ...item, id: item.id_original || item.id })
        }
        setIsFormOpen(true)
    }

    const handleDelete = async (item: any) => {
        try {
            await deleteWorkItem(orgSlug, item.id)
            toast.success('Registro eliminado')
            loadData()
        } catch (e: any) {
            const msg = e?.response?.data?.errors?.[0]?.message
                || e?.message
                || 'Error al eliminar el registro'
            toast.error(msg)
        }
    }

    const handleMarkPaid = (item: any) => {
        setItemToPay({ ...item, id: item.id_original || item.id })
        setIsPaymentModalOpen(true)
    }

    const clearFilters = () => {
        setFilterAdmisor('')
        setFilterDateFrom('')
        setFilterDateTo('')
        setFilterType(FILTER_ALL)
        setFilterStatus(FILTER_ALL)
    }

    const hasActiveFilters = filterAdmisor || filterDateFrom || filterDateTo
        || (filterType && filterType !== FILTER_ALL)
        || (filterStatus && filterStatus !== FILTER_ALL)

    // ── Derived data ──────────────────────────────────────────────────────────
    const professionals = config.professionals || []

    // Client-side admisor filter (since backend doesn't expose a direct professionalName filter)
    const filteredData = useMemo(() => {
        if (!filterAdmisor) return localData
        return localData.filter(item => item.admisorName === filterAdmisor)
    }, [localData, filterAdmisor])

    // ── Columns ───────────────────────────────────────────────────────────────
    const columns = useMemo<ColumnDef<any>[]>(() => [
        {
            accessorKey: 'date',
            header: 'Fecha',
            cell: ({ row }) => format(row.getValue('date'), 'dd-MM-yyyy'),
        },
        {
            accessorKey: 'patientName',
            header: 'Paciente',
            cell: ({ row }) => <span className="font-medium">{row.getValue('patientName')}</span>,
        },
        {
            accessorKey: 'admisorName',
            header: 'Profesional',
            cell: ({ row }) => <span className="text-sm">{row.getValue('admisorName')}</span>,
        },
        {
            accessorKey: 'serviceType',
            header: 'Tipo',
            cell: ({ row }) => <span className="capitalize text-sm">{row.getValue('serviceType')}</span>,
        },
        {
            accessorKey: 'admissionValue',
            header: 'Valor',
            cell: ({ row }) => <span className="font-medium">{formatCurrency(row.getValue('admissionValue'))}</span>,
        },
        {
            accessorKey: 'paymentStatus',
            header: 'Estado',
            cell: ({ row }) => <StatusBadge status={row.original.paymentStatus} />,
        },
        {
            accessorKey: 'paymentDate',
            header: 'Fecha de Cobro',
            cell: ({ row }) => {
                const date = row.getValue('paymentDate') as string
                if (!date) return <span className="text-muted-foreground">-</span>
                return format(new Date((date as string).substring(0, 10) + 'T12:00:00'), 'dd-MM-yyyy')
            },
        },
        {
            accessorKey: 'paymentMethod',
            header: 'Medio de Pago',
            cell: ({ row }) => {
                const method = row.getValue('paymentMethod') as string | null
                if (!method) return <span className="text-muted-foreground text-xs">-</span>
                return <span className="text-sm">{method}</span>
            },
        },
        {
            id: 'actions',
            cell: ({ row }) => {
                const item = row.original
                const paid = isPaidStatus(item.paymentStatus)
                return (
                    <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => handleView(item)} title="Ver Detalle">
                            <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon"
                            className={`h-8 w-8 ${paid ? 'opacity-40 cursor-not-allowed' : 'text-muted-foreground hover:text-primary'}`}
                            onClick={() => !paid && handleEdit(item)}
                            disabled={paid} title={paid ? 'No se puede editar una actividad cobrada' : 'Editar'}>
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon"
                            className={`h-8 w-8 ${paid ? 'text-green-500 opacity-50 cursor-not-allowed' : 'text-muted-foreground hover:text-green-600'}`}
                            onClick={() => !paid && handleMarkPaid(item)}
                            disabled={paid} title={paid ? 'Ya cobrado' : 'Marcar Cobrado'}>
                            <CreditCard className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon"
                            className={`h-8 w-8 ${paid ? 'opacity-40 cursor-not-allowed' : 'text-destructive hover:bg-destructive/10'}`}
                            onClick={() => !paid && setConfirmDelete(item)}
                            disabled={paid} title={paid ? 'No se puede eliminar una actividad cobrada' : 'Eliminar'}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                )
            },
        },
    ], [categories])

    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div className="space-y-4">

            {/* ── Filter bar ── */}
            <div className="flex flex-wrap items-end gap-3">

                {/* Profesional (client-side) */}
                <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">Profesional</label>
                    <select
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm min-w-[160px]"
                        value={filterAdmisor}
                        onChange={e => setFilterAdmisor(e.target.value)}
                    >
                        <option value="">Todos</option>
                        {professionals.map((p: any) => (
                            <option key={p.id} value={p.name}>{p.name}</option>
                        ))}
                    </select>
                </div>

                {/* Date range */}
                <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">Desde</label>
                    <Input type="date" className="h-9 w-36 text-sm"
                        value={filterDateFrom}
                        onChange={e => setFilterDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">Hasta</label>
                    <Input type="date" className="h-9 w-36 text-sm"
                        value={filterDateTo}
                        onChange={e => setFilterDateTo(e.target.value)} />
                </div>

                {/* Activity type */}
                <div className="space-y-1 min-w-[160px]">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">Tipo de Actividad</label>
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={FILTER_ALL}>Todos</SelectItem>
                            {activityTypes.map((t: any) => (
                                <SelectItem key={t.code} value={t.code}>{t.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Payment status */}
                <div className="space-y-1 min-w-[140px]">
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase">Estado</label>
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value={FILTER_ALL}>Todos</SelectItem>
                            <SelectItem value="PAID">Cobrado</SelectItem>
                            <SelectItem value="UNPAID">Pendiente</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Clear + New */}
                <div className="flex items-end gap-2 ml-auto">
                    {hasActiveFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 gap-1 text-muted-foreground">
                            <X className="h-3.5 w-3.5" /> Limpiar
                        </Button>
                    )}
                    <Button onClick={() => { setEditingItem(null); setIsFormOpen(true) }} className="h-9">
                        <Plus className="mr-2 h-4 w-4" /> Nueva Actividad
                    </Button>
                </div>
            </div>

            {/* ── Table ── */}
            <div className="relative">
                <div
                    className="overflow-x-auto rounded-md"
                    style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' }}
                >
                    <div className="min-w-[860px]">
                        <DataTable columns={columns} data={filteredData} hidePagination={true} />
                    </div>
                </div>
                {/* Indicador visual de scroll derecho */}
                <div
                    className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-md"
                    style={{ background: 'linear-gradient(to left, hsl(var(--background)) 10%, transparent)' }}
                    aria-hidden="true"
                />
            </div>

            {/* ── Pagination ── */}
            <div className="flex items-center justify-between px-2">
                <div className="flex items-center space-x-4">
                    <span className="text-xs text-muted-foreground">
                        {total === 0 ? 'Sin resultados' : `${((page - 1) * limit) + 1}–${Math.min(page * limit, total)} de ${total}`}
                    </span>
                    <select
                        className="h-8 w-[70px] rounded-md border border-input bg-background px-2 py-1 text-xs"
                        value={limit}
                        onChange={e => { setLimit(Number(e.target.value)); setPage(1) }}
                    >
                        {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
                <div className="flex items-center space-x-2">
                    <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}>Anterior</Button>
                    <span className="text-xs font-medium">Página {page} de {Math.ceil(total / limit) || 1}</span>
                    <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}
                        disabled={page >= Math.ceil(total / limit) || loading}>Siguiente</Button>
                </div>
            </div>

            {/* ── Modals ── */}
            <WorkItemForm
                isOpen={isFormOpen}
                onClose={() => { setIsFormOpen(false); setEditingItem(null) }}
                onSubmit={handleSave}
                initialData={editingItem}
                orgSlug={orgSlug}
                rulesOrg={config}
                rulesPro={{}}
                mode='ORGANIZATION'
            />

            <ActivityDetailDialog
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                activity={detailItem}
                categories={categories}
                noCoAdmisorBehavior="TO_ADMISOR"
            />

            <PaymentRegistrationModal
                isOpen={isPaymentModalOpen}
                onClose={() => { setIsPaymentModalOpen(false); setItemToPay(null) }}
                onConfirm={async (items, date, method) => {
                    for (const item of items) {
                        await updateWorkItem(orgSlug, item.id.toString(), {
                            paymentStatus: PAYMENT_STATUS.PAID,
                            paymentDate: date,
                            paymentMethod: method,
                        })
                    }
                    setIsPaymentModalOpen(false)
                    setItemToPay(null)
                    loadData()
                }}
                items={itemToPay ? [{
                    id: itemToPay.id,
                    patient: itemToPay.patientName,
                    gross: itemToPay.fees,
                    presetId: 'custom',
                }] : []}
                rulesOrg={config}
            />

            <ConfirmDialog
                isOpen={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                onConfirm={() => handleDelete(confirmDelete)}
                title="Eliminar registro"
                description="¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />
        </div>
    )
}
