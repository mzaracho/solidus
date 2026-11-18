'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { PAYMENT_METHOD } from '@/lib/constants'
import { isValidPaymentDate, todayLocalISO } from '@/lib/payment-date'
import { PaymentDateField } from './PaymentDateField'

type PaymentItem = {
    id: string | number
    patient: string
    gross: number // Original Pending Amount (Base value usually)
    hours?: number
    presetId?: string // To look up rules for card surcharges
}

type Props = {
    isOpen: boolean
    onClose: () => void
    onConfirm: (items: PaymentItem[], date: string, method: string) => void
    items: PaymentItem[]
    rulesOrg: any // Organization Rules to lookup card values
}

/**
 * Modal to register payments for one or multiple items.
 * Handles calculation of final amount based on Payment Method (e.g. Credit Card surcharge).
 */
export function PaymentRegistrationModal(props: Props) {
    // Se monta solo mientras esta abierto: cada apertura arranca con la fecha de hoy y el medio por defecto.
    if (!props.isOpen) return null
    return <PaymentRegistrationBody {...props} />
}

function PaymentRegistrationBody({ isOpen, onClose, onConfirm, items, rulesOrg }: Props) {
    // Fecha de pago (017, criterio 16): obligatoria, precargada con HOY en zona horaria local (no toISOString: en
    // UTC corre el dia a la noche), modificable, y una sola para todas las atenciones del cobro.
    const [paymentDate, setPaymentDate] = useState(() => todayLocalISO())
    const [paymentMethod, setPaymentMethod] = useState<string>(PAYMENT_METHOD.CASH)


    if (!items || items.length === 0) return null

    // Calculate totals based on method, IGNORING original stored gross if method implies a different rate
    const calculateTotal = () => {
        let total = 0
        let originalPendingTotal = 0

        items.forEach(item => {
            const preset = rulesOrg?.values?.find((v: any) => v.id === item.presetId)

            // Original value (likely Base/Cash) stored in item
            originalPendingTotal += item.gross

            // Recalculated value based on selected method
            let unitPrice = 0
            if (preset) {
                unitPrice = (paymentMethod === PAYMENT_METHOD.CREDIT_CARD && preset.cardValue)
                    ? preset.cardValue
                    : preset.value
            } else {
                // Fallback if no preset: assumes gross is total, divide by hours to get unit if needed, or just use gross
                // For simplicity in fallback, we just use the gross value (assuming cash)
                unitPrice = item.gross / (item.hours || 1)
            }

            const finalVal = unitPrice * (item.hours || 1)
            total += finalVal
        })
        return { total, originalPendingTotal }
    }

    const { total, originalPendingTotal } = calculateTotal()
    const diff = total - originalPendingTotal

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>
                        {items.length > 1 ? `Registrar Pago Múltiple (${items.length})` : 'Registrar Pago'}
                    </DialogTitle>
                </DialogHeader>

                <div className="text-sm text-muted-foreground mb-4 max-h-24 overflow-y-auto">
                    Pagando: <strong>{items[0].patient}</strong>
                    {items.length > 1 && <span className="text-xs ml-1">(y {items.length - 1} más)</span>}
                </div>

                <div className="space-y-4 mb-6">
                    <div className="grid grid-cols-2 gap-4">
                        <PaymentDateField id="payment-registration-date" value={paymentDate} onChange={setPaymentDate} />
                        <div className="space-y-1.5">
                            <label className="text-xs font-semibold text-muted-foreground uppercase">Medio de Pago</label>
                            <Select
                                value={paymentMethod}
                                onValueChange={setPaymentMethod}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Efectivo">Efectivo</SelectItem>
                                    <SelectItem value="Transferencia">Transferencia</SelectItem>
                                    <SelectItem value="Tarjeta de Crédito">Tarjeta de Crédito</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="p-4 bg-muted/20 rounded-lg border space-y-2">
                        <div className="flex justify-between text-sm text-muted-foreground">
                            <span>Monto Original (Pendiente):</span>
                            <span className="line-through decoration-muted-foreground/50">${originalPendingTotal.toLocaleString()}</span>
                        </div>
                        <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg text-foreground">
                            <span>Nuevo Total a Cobrar:</span>
                            <span>${total.toLocaleString()}</span>
                        </div>
                        {Math.abs(diff) > 0 && (
                            <p className={`text-[10px] italic text-right ${diff > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {diff > 0 ? `* Incluye ajuste por tarifa tarjeta (+${diff.toLocaleString()})` : `* Ajuste a precio base (${diff.toLocaleString()})`}
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button
                        onClick={() => onConfirm(items, paymentDate, paymentMethod)}
                        disabled={!isValidPaymentDate(paymentDate)}
                    >
                        Confirmar Cobro
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
