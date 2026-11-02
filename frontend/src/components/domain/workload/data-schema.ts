/** Fila de la tabla de carga de trabajo, mapeada desde un ítem de `GET /activity`. */
export type WorkItem = {
    id: string
    date: Date
    patientName: string
    professionalName: string
    professionalId: string | null
    serviceType: string
    payerName: string
    /** PaymentStatus del backend (ver PAYMENT_STATUS en lib/constants). */
    status: string
    paymentDate: string | null
    createdByUserId: string | null
    /** Monto total (grossAmount). */
    grossAmount: number | null
    /** Neto del profesional: suma de los splits PROFESSIONAL que calcula la API. null si no viene. */
    netAmount: number | null
}

const asNumber = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Ítem de `GET /activity` (solo los campos que usa esta tabla; todos pueden faltar). */
export type ApiActivity = {
    id: string | number
    date: string
    patientName?: string | null
    professionalId?: string | null
    professionalName?: string | null
    serviceType?: string | null
    payerName?: string | null
    status?: string | null
    paymentDate?: string | null
    createdByUserId?: string | null
    grossAmount?: number | string | null
    netAmount?: number | string | null
}

/** Mapea un ítem de `GET /activity` (modo ORGANIZATION) a la fila de la tabla. */
export function mapActivityToWorkItem(i: ApiActivity): WorkItem {
    return {
        id: String(i.id),
        // Mediodía para que la zona horaria no retroceda el día (igual que AtencionesTable)
        date: new Date(`${String(i.date).substring(0, 10)}T12:00:00`),
        patientName: i.patientName || '—',
        professionalName: i.professionalName || '—',
        professionalId: i.professionalId ?? null,
        serviceType: i.serviceType || '—',
        payerName: i.payerName && i.payerName !== 'Unknown' ? i.payerName : '—',
        status: i.status || '',
        paymentDate: i.paymentDate ?? null,
        createdByUserId: i.createdByUserId ?? null,
        grossAmount: asNumber(i.grossAmount),
        netAmount: asNumber(i.netAmount),
    }
}
