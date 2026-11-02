'use client'

import { useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Check, X } from 'lucide-react'
import { format } from 'date-fns'

import { WorkItem } from './data-schema'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_STATUS } from '@/lib/constants'
import { canDeleteActivity } from '@/lib/activity-permissions'
import { readSessionIdentity } from '@/lib/session'
import { useStore } from '@/store/useStore'
import { RetroactiveModal } from './RetroactiveModal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateWorkItem, deleteWorkItem, isHandledApiError } from '@/services/data'
import { useParams, useRouter } from 'next/navigation'
import { toast } from 'sonner'

// ─── Status helpers ───────────────────────────────────────────────────────────

/** Map backend PaymentStatus enum → display label */
function statusLabel(status: string): string {
    if (status === PAYMENT_STATUS.PAID) return 'Pagado'
    if (status === PAYMENT_STATUS.PARTIAL) return 'Parcial'
    return 'Pendiente'
}

/** True when the activity is fully paid */
function isPaidStatus(status: string): boolean {
    return status === PAYMENT_STATUS.PAID
}

function StatusBadge({ status }: { status: string }) {
    if (isPaidStatus(status)) {
        return <Badge className="bg-green-600 hover:bg-green-700 text-white">Pagado</Badge>
    }
    if (status === PAYMENT_STATUS.PARTIAL) {
        return <Badge className="bg-amber-500 hover:bg-amber-600 text-white">Parcial</Badge>
    }
    return <Badge variant="secondary">Pendiente</Badge>
}

// ─── Actions cell ─────────────────────────────────────────────────────────────

const ActionsCell = ({ row }: { row: any }) => {
    const payment = row.original
    const [showRetroactive, setShowRetroactive] = useState(false)
    const [showConfirmDelete, setShowConfirmDelete] = useState(false)
    const { orgSlug } = useParams() as { orgSlug: string }
    const router = useRouter()
    const { orgRole } = useStore()

    const alreadyPaid = isPaidStatus(payment.status)

    const handleUpdateStatus = async (paymentStatus: string) => {
        try {
            await updateWorkItem(orgSlug, payment.id, { paymentStatus })
            toast.success('Estado actualizado')
            router.refresh()
        } catch (e) {
            if (isHandledApiError(e)) return
            toast.error('Error al actualizar estado')
        }
    }

    const isRestrictedForDelete = alreadyPaid && !!payment.paymentDate
    // MEMBER: solo borra lo propio (política del 007). Solo presentación: el backend responde 403 si no corresponde.
    const canDelete = canDeleteActivity(orgRole, payment, readSessionIdentity())
    const deleteDisabled = isRestrictedForDelete || !canDelete
    const deleteTitle = !canDelete
        ? 'Solo podés eliminar tus propias atenciones'
        : isRestrictedForDelete
            ? 'No se puede eliminar una actividad ya cobrada con fecha de pago'
            : undefined

    const handleDelete = async () => {
        try {
            await deleteWorkItem(orgSlug, payment.id)
            toast.success('Registro eliminado')
            router.refresh()
        } catch (e) {
            if (isHandledApiError(e)) return
            toast.error('Error al eliminar')
        }
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                        <span className="sr-only">Abrir menú</span>
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => navigator.clipboard.writeText(payment.id)}>
                        Copiar ID
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setShowRetroactive(true)}>
                        Editar
                    </DropdownMenuItem>

                    {!alreadyPaid && (
                        <DropdownMenuItem onClick={() => handleUpdateStatus(PAYMENT_STATUS.PAID)} className="text-green-600">
                            <Check className="mr-2 h-4 w-4" /> Marcar Pagado
                        </DropdownMenuItem>
                    )}

                    {alreadyPaid && (
                        <DropdownMenuItem onClick={() => handleUpdateStatus(PAYMENT_STATUS.UNPAID)} className="text-orange-600">
                            <X className="mr-2 h-4 w-4" /> Marcar Pendiente
                        </DropdownMenuItem>
                    )}

                    <DropdownMenuItem
                        className={deleteDisabled ? "text-muted-foreground cursor-not-allowed" : "text-red-600"}
                        disabled={deleteDisabled}
                        onClick={() => !deleteDisabled && setShowConfirmDelete(true)}
                        title={deleteTitle}
                    >
                        Eliminar
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <ConfirmDialog
                isOpen={showConfirmDelete}
                onClose={() => setShowConfirmDelete(false)}
                onConfirm={handleDelete}
                title="Eliminar registro"
                description="¿Estás seguro de que deseas eliminar este registro? Esta acción no se puede deshacer."
                confirmLabel="Eliminar"
                variant="destructive"
            />

            <RetroactiveModal
                item={payment}
                open={showRetroactive}
                onOpenChange={setShowRetroactive}
                onConfirm={async (updated) => {
                    try {
                        // El backend (PUT /activity/:id) hoy no persiste monto ni pagador: ver 04-implementacion.md
                        await updateWorkItem(orgSlug, payment.id, { grossAmount: updated.grossAmount, payerName: updated.payerName })
                        toast.success('Actualizado correctamente')
                        setShowRetroactive(false)
                        router.refresh()
                    } catch (e) {
                        if (isHandledApiError(e)) return
                        toast.error('Error al guardar cambios')
                    }
                }}
            />
        </>
    )
}

// ─── Column definitions ───────────────────────────────────────────────────────

const EMPTY = <span className="text-muted-foreground">—</span>

export const columns: ColumnDef<WorkItem>[] = [
    {
        accessorKey: 'date',
        header: 'Fecha',
        cell: ({ row }) => format(row.original.date, 'dd-MM-yyyy'),
    },
    {
        accessorKey: 'professionalName',
        header: 'Profesional',
    },
    {
        accessorKey: 'patientName',
        header: 'Paciente',
    },
    {
        accessorKey: 'serviceType',
        header: 'Práctica',
        cell: ({ row }) => <span className="capitalize">{row.original.serviceType}</span>,
    },
    {
        accessorKey: 'payerName',
        header: 'Pagador',
        cell: ({ row }) => <span className="font-medium">{row.original.payerName}</span>,
    },
    {
        accessorKey: 'status',
        header: 'Estado',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
        accessorKey: 'grossAmount',
        header: 'Monto Total',
        cell: ({ row }) => {
            const val = row.original.grossAmount
            return val === null ? EMPTY : <div className="font-medium">{formatCurrency(val)}</div>
        },
    },
    {
        accessorKey: 'netAmount',
        header: 'Neto Prof.',
        cell: ({ row }) => {
            const val = row.original.netAmount
            return val === null ? EMPTY : <div className="text-green-600 font-medium">{formatCurrency(val)}</div>
        },
    },
    {
        id: 'actions',
        cell: ({ row }) => <ActionsCell row={row} />,
    },
]
