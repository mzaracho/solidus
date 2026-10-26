'use client'

import { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

export type PacienteSession = {
    id: string
    date: Date
    patientName: string
    professionalName: string
    paymentDate: Date
    sessionValue: number
    professionalSplit: number // e.g. 0.7 for 70%
    paid: boolean
    type: string
    paymentMethod?: string
}

export const columns: ColumnDef<PacienteSession>[] = [
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
        header: 'Fecha Sesión',
        cell: ({ row }) => format(row.getValue('date'), 'dd-MM-yyyy'),
    },
    {
        accessorKey: 'patientName',
        header: 'Nombre Paciente',
        cell: ({ row }) => <span className="font-medium">{row.getValue('patientName')}</span>,
    },
    {
        accessorKey: 'professionalName',
        header: 'Profesional',
    },
    {
        accessorKey: 'paymentDate',
        header: 'Fecha de Pago',
        cell: ({ row }) => format(row.getValue('paymentDate'), 'dd-MM-yyyy'),
    },
    {
        accessorKey: 'sessionValue',
        header: 'Valor Sesión',
        cell: ({ row }) => formatCurrency(row.getValue('sessionValue')),
    },
    {
        id: 'fundacionShare',
        header: '$ Fundación',
        cell: ({ row }) => {
            const val = row.original.sessionValue
            const split = row.original.professionalSplit
            const fundShare = val * (1 - split)
            return <span className="text-muted-foreground">{formatCurrency(fundShare)}</span>
        }
    },
    {
        id: 'professionalShare',
        header: '$ Profesional',
        cell: ({ row }) => {
            const val = row.original.sessionValue
            const split = row.original.professionalSplit
            const profShare = val * split
            return <span className="font-semibold text-green-700">{formatCurrency(profShare)}</span>
        }
    },
    {
        id: 'split',
        header: '% Prof',
        cell: ({ row }) => <Badge variant="outline">{row.original.professionalSplit * 100}%</Badge>
    }
]
