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
import { PAYMENT_STATUS, PAYMENT_DATE_TEXTS, ACTIVITY_EDIT_TEXTS } from '@/lib/constants'
import { canDeleteActivity, isActivityCollected } from '@/lib/activity-permissions'
import { MarkPaidDialog } from '@/components/domain/payment/MarkPaidDialog'
import { useSessionIdentity } from '@/components/providers/SessionProvider'
import { useStore } from '@/store/useStore'
import { RetroactiveModal } from './RetroactiveModal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateWorkItem, deleteWorkItem, isHandledApiError } from '@/services/data'
import { useParams, useRouter } from 'next/navigation'
import { errorMessageOf } from '@/lib/api-errors'
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
    const [showMarkPaid, setShowMarkPaid] = useState(false)
    const { orgSlug } = useParams() as { orgSlug: string }
    const router = useRouter()
    const { orgRole } = useStore()
    const sessionIdentity = useSessionIdentity()

    const alreadyPaid = isPaidStatus(payment.status)

    /** Pasar a Pendiente no pide fecha. */
    const handleMarkUnpaid = async () => {
        try {
            await updateWorkItem(orgSlug, payment.id, { paymentStatus: PAYMENT_STATUS.UNPAID })
            toast.success('Estado actualizado')
            router.refresh()
        } catch (e) {
            if (isHandledApiError(e)) return
            toast.error(errorMessageOf(e, 'Error al actualizar estado'))
        }
    }

    /** Marcar como pagada exige la fecha de pago (017, criterio 16): la pide MarkPaidDialog. */
    const handleMarkPaid = async (paymentDate: string) => {
        try {
            await updateWorkItem(orgSlug, payment.id, { paymentStatus: PAYMENT_STATUS.PAID, paymentDate })
            toast.success(PAYMENT_DATE_TEXTS.markedPaid)
            router.refresh()
        } catch (e) {
            if (!isHandledApiError(e)) toast.error(errorMessageOf(e, PAYMENT_DATE_TEXTS.markPaidError))
            throw e
        }
    }

    // La definicion de "cobrada" la fija el backend (isCollected); el front no la repite.
    const isRestrictedForDelete = isActivityCollected(payment)
    // MEMBER: solo borra lo propio (política del 007). Solo presentación: el backend responde 403 si no corresponde.
    const canDelete = canDeleteActivity(orgRole, payment, sessionIdentity)
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
                        <DropdownMenuItem onClick={() => setShowMarkPaid(true)} className="text-green-600">
                            <Check className="mr-2 h-4 w-4" /> Marcar Pagado
                        </DropdownMenuItem>
                    )}

                    {alreadyPaid && (
                        <DropdownMenuItem onClick={handleMarkUnpaid} className="text-orange-600">
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

            <MarkPaidDialog
                open={showMarkPaid}
                onOpenChange={setShowMarkPaid}
                description={`Atención de ${payment.patientName}.`}
                onConfirm={handleMarkPaid}
            />

            <RetroactiveModal
                item={payment}
                open={showRetroactive}
                orgSlug={orgSlug}
                onOpenChange={setShowRetroactive}
                // El modal informa exito solo despues de que el backend confirma: onSave lanza si lo rechaza.
                onSave={async (changes) => {
                    await updateWorkItem(orgSlug, payment.id, changes)
                    router.refresh()
                }}
                onConflict={() => router.refresh()}
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
        cell: ({ row }) => row.original.payerName
            ? <span className="font-medium">{row.original.payerName}</span>
            : <span className="text-muted-foreground italic">{ACTIVITY_EDIT_TEXTS.noPayer}</span>,
    },
    {
        accessorKey: 'status',
        header: 'Estado',
        cell: ({ row }) => (
            <div className="flex flex-col items-start gap-0.5">
                <StatusBadge status={row.original.status} />
                {isPaidStatus(row.original.status) && !row.original.paymentDate && (
                    <span className="text-xs text-muted-foreground">{PAYMENT_DATE_TEXTS.missingInTable}</span>
                )}
            </div>
        ),
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
