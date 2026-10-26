'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { ChevronDown, Info } from 'lucide-react'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'

type Props = {
    data: any[] // Pre-calculated settlements from backend
    selectedMonth: string
    onMonthChange: (month: string) => void
    loading: boolean
}

/**
 * Component to view calculated payouts for professionals.
 * Logic is now handled by Backend (CalculateSettlementsQuery).
 */
export function ProfessionalPayouts({ data, selectedMonth, onMonthChange, loading }: Props) {
    const [expandedPro, setExpandedPro] = useState<string | null>(null)

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Cargando liquidaciones...</div>
    }

    const renderRow = (d: any, idx: number) => (
        <tr key={d.id || idx}>
            <td className="px-2 py-2">{d.date.substring(0, 10)}</td>
            <td className="px-2 py-2 font-medium">{d.patient}</td>
            <td className="px-2 py-2">{d.type}</td>
            <td className="px-2 py-2 text-right text-muted-foreground">${d.calculationBase.toLocaleString()}</td>
            <td className="px-2 py-2 text-center">{d.percent}%</td>
            <td className="px-2 py-2 text-right text-emerald-700 font-bold">${d.payoutAmount.toLocaleString()}</td>
        </tr>
    )

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Liquidación a Profesionales</h2>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => onMonthChange(e.target.value)}
                        className="border border-input rounded-lg px-3 py-1.5 text-sm outline-none bg-background"
                    />
                </div>
            </div>

            <div className="grid gap-4">
                {data.map((item: any) => {
                    // Item structure from backend: { name, count, grossBase, payout, details: [] }
                    // We map logic here for UI
                    const isExpanded = expandedPro === item.name

                    return (
                        <Card key={item.professionalId || item.name} className="overflow-hidden">
                            <div
                                className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => setExpandedPro(isExpanded ? null : item.name)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary font-bold">
                                        {item.name.charAt(0)}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-foreground">{item.name}</h3>
                                        <p className="text-xs text-muted-foreground">{item.count} atenciones</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-8 text-right">
                                    <div className="text-right">
                                        <p className="text-xs text-muted-foreground uppercase font-semibold">Total Base</p>
                                        <p className="text-muted-foreground font-mono">${item.grossBase.toLocaleString()}</p>
                                        <p className="text-[10px] text-muted-foreground">Suma bruta de atenciones</p>
                                    </div>
                                    <div>
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex items-center gap-1 cursor-help justify-end">
                                                        <p className="text-xs text-emerald-600 uppercase font-semibold">Total A Pagar</p>
                                                        <Info size={12} className="text-muted-foreground" />
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-xs text-xs">
                                                    <p>
                                                        Suma de los honorarios netos de cada atención (Base × % aplicado por regla).
                                                        Expandí el detalle para ver el desglose atención por atención.
                                                    </p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                        <p className="text-lg font-bold text-foreground font-mono">${item.payout.toLocaleString()}</p>
                                    </div>
                                    <ChevronDown size={20} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                            </div>

                            {isExpanded && (
                                <div className="border-t border-border bg-muted/20 p-4">
                                    <table className="w-full text-xs text-left">
                                        <thead className="text-muted-foreground uppercase border-b border-border">
                                            <tr>
                                                <th className="px-2 py-2">Fecha</th>
                                                <th className="px-2 py-2">Paciente</th>
                                                <th className="px-2 py-2">Actividad</th>
                                                <th className="px-2 py-2 text-right">Base (A)</th>
                                                <th className="px-2 py-2 text-center">% Prof. (B)</th>
                                                <th className="px-2 py-2 text-right text-emerald-700">A Pagar (A × B)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {item.details.map(renderRow)}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </Card>
                    )
                })}
                {data.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed">
                        No se encontraron atenciones para el mes seleccionado o no hay profesionales configurados.
                    </div>
                )}
            </div>
        </div>
    )
}
