'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PAYMENT_DATE_TEXTS } from '@/lib/constants'
import { isValidPaymentDate, todayLocalISO } from '@/lib/payment-date'
import { PaymentDateField } from './PaymentDateField'

interface MarkPaidDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Texto bajo el titulo (por ejemplo, a quien se le marca el cobro). */
    description?: string
    /** Recibe la fecha de pago (yyyy-MM-dd). Si lanza, el dialogo sigue abierto. */
    onConfirm: (paymentDate: string) => Promise<void> | void
}

/**
 * Dialogo para marcar una o varias atenciones como pagadas (017, criterio 16): pide la "Fecha de pago", precargada
 * con hoy, modificable y obligatoria. Una sola fecha para todas las atenciones del cobro.
 */
export function MarkPaidDialog(props: MarkPaidDialogProps) {
    // Se monta solo mientras esta abierto: cada apertura arranca con la fecha de hoy (no arrastra la anterior).
    if (!props.open) return null
    return <MarkPaidDialogBody {...props} />
}

function MarkPaidDialogBody({ open, onOpenChange, description, onConfirm }: MarkPaidDialogProps) {
    const [paymentDate, setPaymentDate] = useState(() => todayLocalISO())
    const [busy, setBusy] = useState(false)

    const valid = isValidPaymentDate(paymentDate)

    const handleConfirm = async () => {
        if (!valid || busy) return
        setBusy(true)
        try {
            await onConfirm(paymentDate)
            onOpenChange(false)
        } catch {
            // quien llama muestra el error; el dialogo queda abierto para reintentar
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>{PAYMENT_DATE_TEXTS.markPaidTitle}</DialogTitle>
                    <DialogDescription>{description ?? PAYMENT_DATE_TEXTS.markPaidDescription}</DialogDescription>
                </DialogHeader>
                <PaymentDateField id="mark-paid-date" value={paymentDate} onChange={setPaymentDate} />
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        {PAYMENT_DATE_TEXTS.cancel}
                    </Button>
                    <Button onClick={handleConfirm} disabled={!valid || busy} aria-busy={busy}>
                        {PAYMENT_DATE_TEXTS.confirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
