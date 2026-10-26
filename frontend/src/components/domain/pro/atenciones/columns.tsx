'use client'

import { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Edit, Trash2, CheckCircle, UserCheck } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { deleteWorkItem, updateWorkItem } from '@/services/data'
import { useParams } from 'next/navigation'
import { ATTENDANCE, PAYER_PARTICULAR } from '@/lib/constants'
import { Eye } from 'lucide-react'

export type Attention = {
    id: string
    date: Date
    patientName: string
    orgName: string
    fees: number
    attended: string
    paid: boolean
    status?: string
    commission: number
    netAmount: number
    paymentDate?: string | Date
    createdByUserId?: string | null
    isExternal: boolean
    organizationName: string
    role?: string | null
}



export const getColumns = (
    onMarkPaid: (item: Attention) => void,
    onDelete: (item: Attention) => void,
    onEdit: (item: Attention) => void,
    onUpdateAttendance: (item: Attention) => void,
    currentUserId: string | null = null,
    onViewDetail?: (item: Attention) => void,
): ColumnDef<Attention>[] => [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox
                    checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
                    onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
                    aria-label="Select all"
                />
            ),
            cell: ({ row }) => (
                <Checkbox
                    checked={row.getIsSelected()}
                    onCheckedChange={(value) => row.toggleSelected(!!value)}
                    aria-label="Select row"
                />
            ),
            enableSorting: false,
            enableHiding: false,
        },
        {
            accessorKey: 'date',
            header: 'Fecha',
            cell: ({ row }) => format(row.getValue('date'), 'dd/MM/yyyy'),
        },
        {
            accessorKey: 'patientName',
            header: 'Paciente',
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <span className="font-medium">{row.getValue('patientName')}</span>
                    {row.original.isExternal && (
                        <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                            {row.original.organizationName}
                        </Badge>
                    )}
                </div>
            ),
        },
        {
            accessorKey: 'orgName',
            header: 'Red / Org',
            cell: ({ row }) => {
                const org = row.getValue('orgName') as string
                return (
                    <Badge variant="secondary" className={org === PAYER_PARTICULAR ? 'bg-muted text-muted-foreground' : ''}>
                        {org}
                    </Badge>
                )
            }
        },
        {
            id: 'role',
            header: 'Rol',
            cell: ({ row }) => {
                const role = row.original.role
                if (!role) return <span className="text-muted-foreground text-xs">-</span>
                return <span className="text-xs">{role}</span>
            },
        },
        {
            accessorKey: 'fees',
            header: 'Honorarios',
            cell: ({ row }) => formatCurrency(row.getValue('fees')),
        },
        {
            accessorKey: 'attended',
            header: 'Asist.',
            cell: ({ row }) => {
                const val = row.getValue('attended') as string
                const map: Record<string, string> = {
                    [ATTENDANCE.PRESENT]: 'Asistió',
                    [ATTENDANCE.ABSENT_WITH_NOTICE]: 'Canceló (+24hs)',
                    [ATTENDANCE.ABSENT_NO_NOTICE]: 'No Asistió',
                }
                return <span className="text-xs">{map[val] || val || '-'}</span>
            },
        },
        {
            accessorKey: 'paid',
            header: () => <div className="text-right">Cobrado</div>,
            cell: ({ row }) => {
                const isPaid = row.getValue('paid')
                const gross = row.original.fees || 0
                // User requested: "valor cobrado si se hizo, sino mostrar $0,00"
                // Assuming if paid, the full gross amount was collected (since partials aren't tracked yet in this view)
                return <div className="text-right font-medium text-emerald-700">
                    {isPaid ? formatCurrency(gross) : formatCurrency(0)}
                </div>
            },
        },
        {
            id: 'commission',
            header: () => <div className="text-right">Comisión</div>,
            cell: ({ row }) => {
                const commission = row.original.commission || 0

                if (commission === 0) return <div className="text-right text-muted-foreground">{formatCurrency(0)}</div>

                return <div className="text-right text-red-600">-{formatCurrency(commission)}</div>
            }
        },
        {
            id: 'net',
            header: () => <div className="text-right">Neto</div>,
            cell: ({ row }) => {
                const net = row.original.netAmount || 0
                return <div className="text-right font-bold text-green-700">{formatCurrency(net)}</div>
            }
        },
        {
            id: 'actions',
            cell: ({ row }) => {
                const payment = row.original
                const isOwner = !payment.createdByUserId || payment.createdByUserId === currentUserId
                // Actividades de orgs externas son siempre read-only
                const canModify = isOwner && !payment.isExternal

                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                                <span className="sr-only">Open menu</span>
                                <MoreHorizontal className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                            {onViewDetail && (
                                <DropdownMenuItem onClick={() => onViewDetail(payment)}>
                                    <Eye className="mr-2 h-4 w-4" /> Ver Detalle
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(payment.id)}>
                                Copiar ID
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onUpdateAttendance(payment)}>
                                <UserCheck className="mr-2 h-4 w-4" /> Cargar Asistencia
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                disabled={payment.paid || !canModify}
                                onClick={() => canModify && onEdit(payment)}
                                title={payment.isExternal ? 'No podés editar actividades de organizaciones externas' : !isOwner ? 'Solo podés editar actividades que cargaste vos' : undefined}
                            >
                                <Edit className="mr-2 h-4 w-4" /> Editar
                            </DropdownMenuItem>
                            {!payment.paid && canModify && (
                                <DropdownMenuItem className="text-green-600 cursor-pointer" onClick={() => onMarkPaid(payment)}>
                                    <CheckCircle className="mr-2 h-4 w-4" /> Marcar Cobrado
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className={canModify && !(payment.paid && payment.paymentDate) ? 'text-red-600 cursor-pointer' : 'text-muted-foreground cursor-not-allowed'}
                                disabled={!canModify || (payment.paid && !!payment.paymentDate)}
                                onClick={() => canModify && onDelete(payment)}
                                title={payment.isExternal ? 'No podés eliminar actividades de organizaciones externas' : !isOwner ? 'Solo podés eliminar actividades que cargaste vos' : (payment.paid && payment.paymentDate) ? 'No se puede eliminar una actividad ya cobrada con fecha de pago' : undefined}
                            >
                                <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )
            },
        },
    ]
