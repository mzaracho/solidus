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

// ─── Sesión y acceso (feature 005) ────────────────────────────────────────────
export const ROUTES = {
    LOGIN: '/login',
    NO_ACCESS: '/sin-acceso',
} as const

// Códigos de error que devuelve el backend en el body (campo `code`).
export const API_ERROR_CODE = {
    UNAUTHORIZED: 'unauthorized',
    ORG_ACCESS_DENIED: 'org-access-denied',
    FORBIDDEN: 'forbidden',
} as const

export const SESSION_MESSAGES = {
    // Login
    loginSubtitle: 'Iniciá sesión para continuar',
    sessionExpired: 'Tu sesión venció. Ingresá de nuevo para continuar.',
    invalidCredentials: 'Usuario o contraseña incorrectos.',
    missingFields: 'Ingresá tu usuario y tu contraseña.',
    network: 'No pudimos conectarnos con el servidor. Revisá tu conexión e intentá de nuevo.',
    server: 'No pudimos iniciar tu sesión por un problema de nuestro lado. Probá de nuevo en unos minutos.',
    unexpected: 'Recibimos una respuesta inesperada del servidor. Probá de nuevo y, si sigue pasando, avisale a soporte.',
    other: 'No pudimos iniciar tu sesión. Probá de nuevo en unos minutos.',
    submitIdle: 'Ingresar',
    submitBusy: 'Ingresando…',
    // Sin acceso
    noAccessTitle: 'Sin acceso a esta organización',
    noAccessDescription: 'No tenés permiso para ver esta organización. Si creés que es un error, pedile acceso a un administrador.',
    noOrgTitle: 'Tu cuenta no tiene organizaciones asignadas',
    noOrgDescription: 'Ingresaste correctamente, pero todavía no pertenecés a ninguna organización. Pedile a un administrador que te dé acceso.',
    backToStart: 'Volver al inicio',
    logout: 'Cerrar sesión',
    // Acción puntual rechazada (403)
    forbiddenAction: 'No tenés permiso para hacer esto en esta organización.',
} as const

// ─── Modo de vista (feature 009) ──────────────────────────────────────────────
// El front pide una vista como preferencia; la vista efectiva la decide el backend segun los vinculos del usuario.
export const VIEW_MODE = {
    ORGANIZATION: 'ORGANIZATION',
    PROFESSIONAL: 'PROFESSIONAL',
} as const

/** Rol de membresia en una organizacion (`orgRole` del token). */
export const ORG_ROLE = {
    ADMIN: 'ADMIN',
    MEMBER: 'MEMBER',
} as const

/** Codigos de rol global del usuario (`roles` del token). */
export const APP_ROLE_CODE = {
    ORGANIZATION: 'ORGANIZATION',
    PROFESSIONAL: 'PROFESSIONAL',
} as const
