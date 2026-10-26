'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { getColumns, Attention } from '../atenciones/columns'
import { DataTable } from '@/components/ui/data-table'
import { getWorkItems, deleteWorkItem, updateWorkItem, getPatientSummary } from '@/services/data'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'
import { PAYMENT_STATUS, ATTENDANCE } from '@/lib/constants'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'

interface SummaryItem {
    id: string
    date: string
    serviceType: string
    grossAmount: number
    paymentStatus: string
    payerName: string
    professionalName: string
}

interface PatientSummary {
    totalDebt: number
    pendingItems: SummaryItem[]
}

export function DeudoresTable() {
    const params = useParams()
    const orgSlug = params.orgSlug as string
    const [data, setData] = useState<Attention[]>([])
    const [loading, setLoading] = useState(true)
    const [summaryOpen, setSummaryOpen] = useState(false)
    const [summaryPatient, setSummaryPatient] = useState<string | null>(null)
    const [summaryPatientName, setSummaryPatientName] = useState<string>('')
    const [summary, setSummary] = useState<PatientSummary | null>(null)
    const [summaryLoading, setSummaryLoading] = useState(false)
    const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} })

    const load = useCallback(async () => {
        if (!orgSlug) return
        setLoading(true)
        const result = await getWorkItems(orgSlug, 'PROFESSIONAL')
        const items = Array.isArray(result) ? result : (result?.items ?? [])

        const unpaid = items
            .filter((i: any) => i.status !== PAYMENT_STATUS.PAID)
            .map((i: any) => ({
                id: i.id.toString(),
                date: new Date(i.date || i.occurredAt),
                patientName: i.patientName || i.patient,
                patientId: i.patientId,
                orgName: i.payerName || i.organizationId || i.payer,
                fees: i.grossAmount || i.amount || i.fees,
                attended: i.attendance || ATTENDANCE.PRESENT,
                paid: false,
                status: i.status,
                commission: i.commission || 0,
                netAmount: i.netAmount !== undefined ? i.netAmount : (i.grossAmount || i.amount || i.fees),
            }))

        setData(unpaid)
        setLoading(false)
    }, [orgSlug])

    useEffect(() => {
        load()
    }, [load])

    const handleDelete = (item: Attention) => {
        setConfirmDialog({
            open: true,
            title: 'Eliminar registro',
            description: '¿Estás seguro de que deseas eliminar este registro?',
            onConfirm: async () => {
                await deleteWorkItem(orgSlug, item.id)
                toast.success('Registro eliminado')
                await load()
            },
        })
    }

    const handleMarkPaid = (item: Attention) => {
        setConfirmDialog({
            open: true,
            title: 'Marcar como Cobrado',
            description: `¿Confirmar cobro para ${item.patientName}?`,
            onConfirm: async () => {
                await updateWorkItem(orgSlug, item.id, { paymentStatus: PAYMENT_STATUS.PAID })
                toast.success('Marcado como cobrado')
                await load()
            },
        })
    }

    const handleViewSummary = async (item: Attention & { patientId?: string }) => {
        const patientId = item.patientId
        if (!patientId) return
        setSummaryPatientName(item.patientName)
        setSummaryPatient(patientId)
        setSummaryOpen(true)
        setSummaryLoading(true)
        const data = await getPatientSummary(orgSlug, patientId)
        setSummary(data)
        setSummaryLoading(false)
    }

    const columns = useMemo(() => getColumns(
        handleMarkPaid,
        handleDelete,
        (item) => handleViewSummary(item as any),
        (_item: Attention) => {}
    ), [orgSlug])

    const statusLabel = (s: string) => {
        if (s === PAYMENT_STATUS.UNPAID) return { label: 'Sin cobrar', variant: 'destructive' as const }
        if (s === PAYMENT_STATUS.PARTIAL) return { label: 'Parcial', variant: 'secondary' as const }
        return { label: s, variant: 'outline' as const }
    }

    if (loading) return <div>Cargando deudores...</div>

    return (
        <>
            <DataTable columns={columns} data={data} />

            <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Deuda de {summaryPatientName}</DialogTitle>
                    </DialogHeader>

                    {summaryLoading ? (
                        <div className="py-8 text-center text-muted-foreground">Cargando...</div>
                    ) : summary ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/20">
                                <span className="text-sm font-medium text-muted-foreground">Total adeudado</span>
                                <span className="text-2xl font-bold text-red-600">
                                    {formatCurrency(summary.totalDebt)}
                                </span>
                            </div>

                            <div className="rounded-md border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead>Tipo</TableHead>
                                            <TableHead>Profesional</TableHead>
                                            <TableHead>OS / Payer</TableHead>
                                            <TableHead className="text-right">Monto</TableHead>
                                            <TableHead>Estado</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {summary.pendingItems.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center h-16 text-muted-foreground">
                                                    Sin deuda pendiente
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            summary.pendingItems.map((item) => {
                                                const st = statusLabel(item.paymentStatus)
                                                return (
                                                    <TableRow key={item.id}>
                                                        <TableCell className="text-sm">
                                                            {format(new Date(item.date), 'dd/MM/yyyy', { locale: es })}
                                                        </TableCell>
                                                        <TableCell className="text-sm">{item.serviceType}</TableCell>
                                                        <TableCell className="text-sm">{item.professionalName}</TableCell>
                                                        <TableCell className="text-sm">{item.payerName}</TableCell>
                                                        <TableCell className="text-right text-sm font-medium">
                                                            {formatCurrency(item.grossAmount)}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant={st.variant}>{st.label}</Badge>
                                                        </TableCell>
                                                    </TableRow>
                                                )
                                            })
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex justify-end">
                                <Button variant="outline" onClick={() => setSummaryOpen(false)}>
                                    Cerrar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="py-8 text-center text-muted-foreground">
                            No se pudo cargar el resumen
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                isOpen={confirmDialog.open}
                onClose={() => setConfirmDialog(d => ({ ...d, open: false }))}
                onConfirm={confirmDialog.onConfirm}
                title={confirmDialog.title}
                description={confirmDialog.description}
                confirmLabel="Confirmar"
                variant="destructive"
            />
        </>
    )
}
