// src/lib/constants.ts

// ─── Payment Status ───────────────────────────────────────────────────────────
export const PAYMENT_STATUS = {
    PAID: 'PAID',
    PARTIAL: 'PARTIAL',
    UNPAID: 'UNPAID',
    PENDING: 'PENDING',
} as const
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS]

// ─── Attendance ───────────────────────────────────────────────────────────────
export const ATTENDANCE = {
    PRESENT: 'PRESENT',
    ABSENT_WITH_NOTICE: 'ABSENT_WITH_NOTICE',
    ABSENT_NO_NOTICE: 'ABSENT_NO_NOTICE',
} as const
export type AttendanceStatus = typeof ATTENDANCE[keyof typeof ATTENDANCE]

// ─── Work Item Types ──────────────────────────────────────────────────────────
export const WORK_ITEM_TYPE = {
    SESSION: 'session',
    AT: 'at',
    ADMISSION: 'admission',
    TEAM_MEETING: 'team_meeting',
    PARENT_ORIENTATION: 'parent_orientation',
    REPORT: 'report',
    SUPERVISION: 'supervision',
    EVALUATION: 'evaluation',
    APTITUDE: 'aptitude',
} as const
export type WorkItemType = typeof WORK_ITEM_TYPE[keyof typeof WORK_ITEM_TYPE]

// ─── Payment Methods ──────────────────────────────────────────────────────────
export const PAYMENT_METHOD = {
    CASH: 'Efectivo',
    CREDIT_CARD: 'Tarjeta de Crédito',
    DEBIT_CARD: 'Tarjeta de Débito',
    TRANSFER: 'Transferencia',
} as const
export type PaymentMethod = typeof PAYMENT_METHOD[keyof typeof PAYMENT_METHOD]

// ─── Form Status Labels (Spanish, used internally in WorkItemForm) ─────────────
export const FORM_STATUS = {
    PENDING: 'Pendiente',
    PAID: 'Pagado',
    PARTIAL: 'Parcial',
} as const
export type FormStatus = typeof FORM_STATUS[keyof typeof FORM_STATUS]

// ─── Payer ────────────────────────────────────────────────────────────────────
export const PAYER_PARTICULAR = 'Particular'

// ─── Filter Placeholder ───────────────────────────────────────────────────────
export const FILTER_ALL = '__all__'

// ─── Pagination ───────────────────────────────────────────────────────────────
export const PAGE_SIZE_OPTIONS = [12, 18, 24] as const
export const DEFAULT_PAGE_SIZE = 12

// ─── Admission Splits ─────────────────────────────────────────────────────────
export const ADMISSION_SPLITS = {
    ADMISOR: 0.50,
    COADMISOR: 0.20,
    FUNDACION: 0.30,
} as const

// ─── Store ────────────────────────────────────────────────────────────────────
export const STORE_NAME = 'solidus-storage'

// ─── Patient Search ───────────────────────────────────────────────────────────
export const MIN_PATIENT_SEARCH_LENGTH = 3

// ─── Type Prefix (internal selector prefix) ──────────────────────────────────
export const ACTIVITY_TYPE_PREFIX = '__type__'
