'use client'

import { useState, useEffect } from 'react'
import { format, differenceInDays } from 'date-fns'
import { AlertTriangle, Lock, Save } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { WorkItem } from './data-schema'
import { formatCurrency } from '@/lib/utils'

interface RetroactiveModalProps {
    item: WorkItem | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: (updatedItem: WorkItem) => void
}

export function RetroactiveModal({ item, open, onOpenChange, onConfirm }: RetroactiveModalProps) {
    const [amount, setAmount] = useState<number>(0)
    const [payer, setPayer] = useState<string>('')
    const [isLocked, setIsLocked] = useState(false)
    const [showWarning, setShowWarning] = useState(false)

    useEffect(() => {
        if (item) {
            setAmount(item.amount)
            setPayer(item.payer)

            // Check 30 days lock
            const daysDiff = differenceInDays(new Date(), item.date)
            const locked = daysDiff > 30
            setIsLocked(locked)

            // Reset warning
            setShowWarning(false)
        }
    }, [item])

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value)
        setAmount(isNaN(val) ? 0 : val)
        setShowWarning(true)
    }

    const handlePayerChange = (val: string) => {
        setPayer(val)
        setShowWarning(true)
    }

    const handleSave = () => {
        if (!item) return

        onConfirm({
            ...item,
            amount,
            payer
        })
        onOpenChange(false)
    }

    if (!item) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        Editar Prestación
                        {isLocked && <BadgeLock />}
                    </DialogTitle>
                    <DialogDescription>
                        ID: {item.id} • {format(item.date, 'dd/MM/yyyy')}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Lock Warning */}
                    {isLocked && (
                        <Alert variant="destructive" className="bg-red-50 text-red-900 border-red-200">
                            <Lock className="h-4 w-4" />
                            <AlertTitle>Edición Bloqueada</AlertTitle>
                            <AlertDescription>
                                Este item tiene más de 30 días. Por seguridad contable no se puede modificar.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Profesional</Label>
                            <Input value={item.professionalName} disabled className="bg-muted" />
                        </div>
                        <div className="space-y-2">
                            <Label>Paciente</Label>
                            <Input value={item.patientName} disabled className="bg-muted" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Pagador (Obra Social)</Label>
                        {isLocked ? (
                            <Input value={payer} disabled />
                        ) : (
                            <Select value={payer} onValueChange={handlePayerChange}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="OSDE">OSDE</SelectItem>
                                    <SelectItem value="Swiss Medical">Swiss Medical</SelectItem>
                                    <SelectItem value="Particular">Particular</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label>Monto Bruto ($)</Label>
                        <div className="relative">
                            <Input
                                type="number"
                                value={amount}
                                onChange={handleAmountChange}
                                disabled={isLocked}
                                className="pl-8 font-mono"
                            />
                            <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                        </div>
                    </div>

                    {/* Impact Warning */}
                    {showWarning && !isLocked && (
                        <Alert className="bg-amber-50 text-amber-900 border-amber-200">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            <AlertTitle className="text-amber-800">Atención: Recálculo Requerido</AlertTitle>
                            <AlertDescription className="text-sm">
                                Modificar estos valores recalculará automáticamente las comisiones para <strong>{item.professionalName}</strong>.
                                <br />
                                <span className="font-semibold mt-1 block">
                                    Nuevo Neto Estimado: {formatCurrency(amount * 0.7)} (70%)
                                </span>
                            </AlertDescription>
                        </Alert>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleSave} disabled={isLocked || !showWarning}>
                        <Save className="w-4 h-4 mr-2" />
                        Confirmar y Recalcular
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function BadgeLock() {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div className="rounded-full bg-muted p-1 text-muted-foreground hover:text-foreground transition-colors cursor-help">
                        <Lock className="w-3 h-3" />
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Bloqueado por antigüedad (&gt;30 días)</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
