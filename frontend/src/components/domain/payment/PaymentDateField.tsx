'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PAYMENT_DATE_TEXTS } from '@/lib/constants'
import { isValidPaymentDate } from '@/lib/payment-date'

/** Mensaje de validacion de una fecha de pago (null si es valida). */
export function paymentDateError(value: string): string | null {
    return isValidPaymentDate(value) ? null : PAYMENT_DATE_TEXTS.invalid
}

interface PaymentDateFieldProps {
    id: string
    /** yyyy-MM-dd en la zona horaria local (ver lib/payment-date). */
    value: string
    onChange: (value: string) => void
    className?: string
    /**
     * Opcional (edicion de una atencion ya pagada sin fecha, 017): vacio es valido, no se marca como obligatorio y
     * se muestra "Sin fecha de pago" como ayuda.
     */
    optional?: boolean
}

/**
 * Campo "Fecha de pago" (feature 017, criterio 16): visible, obligatorio y con la fecha de hoy precargada por
 * quien lo usa. Es un input nativo de tipo date: entrega y recibe yyyy-MM-dd sin pasar por Date/UTC, asi la fecha
 * no se corre un dia.
 */
export function PaymentDateField({ id, value, onChange, className, optional = false }: PaymentDateFieldProps) {
    const error = optional && value === '' ? null : paymentDateError(value)
    const errorId = `${id}-error`
    const hintId = `${id}-hint`
    return (
        <div className={className}>
            <Label htmlFor={id} className="mb-1.5">
                {PAYMENT_DATE_TEXTS.label}
                {!optional && <span className="text-destructive" aria-hidden="true"> *</span>}
            </Label>
            <Input
                id={id}
                type="date"
                required={!optional}
                aria-required={optional ? undefined : true}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : optional && value === '' ? hintId : undefined}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            {optional && value === '' && (
                <p id={hintId} className="mt-1 text-sm text-muted-foreground">
                    {PAYMENT_DATE_TEXTS.missingInTable}
                </p>
            )}
            {error && (
                <p id={errorId} className="mt-1 text-sm text-destructive" role="alert">
                    {error}
                </p>
            )}
        </div>
    )
}
