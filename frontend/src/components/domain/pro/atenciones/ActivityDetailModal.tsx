'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { formatCurrency } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { ATTENDANCE, PAYMENT_STATUS, WORK_ITEM_TYPE } from '@/lib/constants'

const SERVICE_TYPE_LABELS: Record<string, string> = {
    [WORK_ITEM_TYPE.SESSION]: 'Sesión',
    [WORK_ITEM_TYPE.AT]: 'AT',
    [WORK_ITEM_TYPE.ADMISSION]: 'Admisión',
    [WORK_ITEM_TYPE.TEAM_MEETING]: 'Reunión de Equipo',
    [WORK_ITEM_TYPE.PARENT_ORIENTATION]: 'Orientación a Padres',
    [WORK_ITEM_TYPE.REPORT]: 'Informe',
    [WORK_ITEM_TYPE.SUPERVISION]: 'Supervisión',
    [WORK_ITEM_TYPE.EVALUATION]: 'Evaluación',
    [WORK_ITEM_TYPE.APTITUDE]: 'Aptitud',
}

const ATTENDANCE_LABELS: Record<string, string> = {
    [ATTENDANCE.PRESENT]: 'Asistió',
    [ATTENDANCE.ABSENT_WITH_NOTICE]: 'Canceló (+24hs)',
    [ATTENDANCE.ABSENT_NO_NOTICE]: 'No Asistió',
}

const STATUS_LABELS: Record<string, string> = {
    [PAYMENT_STATUS.PAID]: 'Cobrado',
    [PAYMENT_STATUS.PARTIAL]: 'Parcial',
    [PAYMENT_STATUS.UNPAID]: 'Pendiente',
    [PAYMENT_STATUS.PENDING]: 'Pendiente',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex justify-between items-center py-2 border-b last:border-0">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-sm font-medium text-right">{children}</span>
        </div>
    )
}

type Props = {
    item: any | null
    isOpen: boolean
    onClose: () => void
}

export function ActivityDetailModal({ item, isOpen, onClose }: Props) {
    if (!item) return null

    const date = item.date ? new Date(item.date + 'T12:00:00') : null
    const paymentDate = item.paymentDate ? new Date(typeof item.paymentDate === 'string' && item.paymentDate.includes('T') ? item.paymentDate.split('T')[0] + 'T12:00:00' : item.paymentDate + 'T12:00:00') : null

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Detalle de Atención</DialogTitle>
                </DialogHeader>

                <div className="mt-2">
                    <Row label="Fecha">
                        {date ? format(date, 'dd/MM/yyyy', { locale: es }) : '-'}
                    </Row>
                    <Row label="Paciente">{item.patientName || '-'}</Row>
                    <Row label="Profesional">{item.professionalName || '-'}</Row>
                    <Row label="Tipo">
                        {SERVICE_TYPE_LABELS[item.serviceType] || item.serviceType || '-'}
                    </Row>
                    <Row label="Organización">
                        {item.organizationName
                            ? <Badge variant="secondary">{item.organizationName}</Badge>
                            : '-'}
                    </Row>
                    <Row label="Pagador">{item.payerName || '-'}</Row>
                    {item.role && (
                        <Row label="Rol">{item.role}</Row>
                    )}
                    <Row label="Asistencia">
                        {ATTENDANCE_LABELS[item.attendance] || item.attendance || '-'}
                    </Row>
                    <Row label="Estado">
                        <Badge variant={item.status === PAYMENT_STATUS.PAID ? 'default' : 'outline'}>
                            {STATUS_LABELS[item.status] || item.status || '-'}
                        </Badge>
                    </Row>
                    {item.paymentMethod && (
                        <Row label="Método de Pago">{item.paymentMethod}</Row>
                    )}
                    {paymentDate && (
                        <Row label="Fecha de Pago">
                            {format(paymentDate, 'dd/MM/yyyy', { locale: es })}
                        </Row>
                    )}
                    <Row label="Honorarios">{formatCurrency(item.grossAmount ?? 0)}</Row>
                    <Row label="Comisión">
                        <span className="text-red-600">
                            -{formatCurrency(item.commission ?? 0)}
                        </span>
                    </Row>
                    <Row label="Neto">
                        <span className="font-bold text-green-700">
                            {formatCurrency(item.netAmount ?? 0)}
                        </span>
                    </Row>
                </div>
            </DialogContent>
        </Dialog>
    )
}
