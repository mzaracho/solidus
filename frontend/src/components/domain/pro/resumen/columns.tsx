'use client'

import { ColumnDef } from '@tanstack/react-table'
import { formatCurrency } from '@/lib/utils'

export type MonthlySummary = {
    month: string // e.g. "Diciembre 2025"
    totalGross: number
    commissionOrg: number
    commissionOther: number
    totalNet: number
}

export const columns: ColumnDef<MonthlySummary>[] = [
    {
        accessorKey: 'month',
        header: 'Mes',
        cell: ({ row }) => <span className="font-medium capitalize">{row.getValue('month')}</span>,
    },
    {
        accessorKey: 'totalGross',
        header: 'Total Cobrado',
        cell: ({ row }) => formatCurrency(row.getValue('totalGross')),
    },
    {
        id: 'commissions',
        header: 'Comisiones (Detalle)',
        cell: ({ row }) => (
            <div className="flex flex-col text-xs text-muted-foreground">
                <span>Fundación: -{formatCurrency(row.original.commissionOrg)}</span>
                <span>Otras Redes: -{formatCurrency(row.original.commissionOther)}</span>
            </div>
        )
    },
    {
        accessorKey: 'totalNet',
        header: 'Neto Percibido',
        cell: ({ row }) => <span className="text-lg font-bold text-green-700">{formatCurrency(row.getValue('totalNet'))}</span>,
    }
]
