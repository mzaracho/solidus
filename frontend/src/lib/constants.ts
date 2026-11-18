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
    NOT_FOUND: 'not-found',
    VALIDATION_FAILED: 'validation-failed',
    INTERNAL: 'unhandled-exception',
    // Feature 017
    ACTIVITY_ALREADY_COLLECTED: 'activity-already-collected',
    PAYER_HAS_FEE_RULES: 'payer-has-fee-rules',
    PAYER_HAS_ACTIVITIES: 'payer-has-activities',
    PAYMENT_DATE_REQUIRED: 'payment-date-required',
} as const

// Mensajes genericos (en espanol) para los errores de la API cuando el backend no manda uno de negocio
// (feature 013). Los usa src/lib/api-errors.ts.
export const API_ERROR_MESSAGES = {
    badRequest: 'No pudimos procesar la solicitud. Revisá los datos e intentá de nuevo.',
    validation: 'Hay datos incompletos o con formato inválido. Revisalos e intentá de nuevo.',
    notFound: 'No encontramos el registro. Puede que se haya eliminado.',
    conflict: 'No se pudo completar la operación por un conflicto con datos existentes.',
    payloadTooLarge: 'La información enviada es demasiado grande.',
    tooManyRequests: 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.',
    server: 'Ocurrió un problema de nuestro lado. Probá de nuevo en unos minutos.',
    generic: 'No pudimos completar la operación. Probá de nuevo.',
    // Respaldo de los errores de negocio del 017 (mismo texto que el backend; el del backend tiene prioridad)
    activityAlreadyCollected: 'Esta atención ya está cobrada: el monto y el pagador no se pueden modificar. No se guardó ningún cambio.',
    payerHasFeeRules: 'No se puede eliminar el pagador porque tiene reglas de honorarios asociadas.',
    payerHasActivities: 'No se puede eliminar el pagador porque tiene atenciones asociadas.',
    paymentDateRequired: 'Para marcar la atención como pagada tenés que indicar la fecha de pago.',
} as const

// ─── Edición de monto y pagador (feature 017) ─────────────────────────────────
export const ACTIVITY_EDIT_TEXTS = {
    recalcTitle: 'Se recalcularán los honorarios',
    recalcBody: 'Al cambiar el monto o el pagador, se recalculan los honorarios y la distribución con las reglas vigentes. Los ajustes manuales que hayas hecho en esta atención se reemplazan.',
    collectedLock: 'Esta atención ya está cobrada: el monto y el pagador no se pueden modificar.',
    save: 'Guardar',
    saveRecalc: 'Guardar y recalcular',
    saving: 'Guardando…',
    noPayer: 'Sin pagador',
    selectPayer: 'Seleccionar pagador…',
    loadingPayers: 'Cargando pagadores…',
    noPayersAvailable: 'No hay pagadores disponibles',
    noPayersHelp: 'Creá un pagador en Configuración para poder asignarlo.',
    updated: 'Atención actualizada.',
    updatedRecalc: 'Atención actualizada. Se recalcularon los honorarios.',
    saveError: 'No pudimos guardar los cambios. Probá de nuevo.',
    invalidAmount: 'Ingresá un monto válido.',
    negativeAmount: 'El monto no puede ser negativo.',
    tooManyDecimals: 'El monto admite hasta 2 decimales.',
    amountLabel: 'Monto bruto ($)',
    payerLabel: 'Pagador',
    pickAnotherPayer: 'Elegí otro pagador.',
} as const

// ─── Fecha de pago (feature 017, criterio 16) ─────────────────────────────────
export const PAYMENT_DATE_TEXTS = {
    label: 'Fecha de pago',
    invalid: 'Ingresá una fecha de pago válida.',
    missingInTable: 'Sin fecha de pago',
    markPaidTitle: 'Marcar como pagada',
    markPaidDescription: 'Indicá la fecha en que se pagó. Se usa la misma fecha para todas las atenciones seleccionadas.',
    confirm: 'Confirmar',
    cancel: 'Cancelar',
    markedPaid: 'Marcado como pagado',
    markPaidError: 'No pudimos marcar la atención como pagada. Probá de nuevo.',
} as const

// ─── Pagadores (feature 017) ──────────────────────────────────────────────────
export const PAYER_TEXTS = {
    deleteTitle: (name: string) => `Eliminar pagador ${name}`,
    deleteAria: (name: string) => `Eliminar pagador ${name}`,
    deleteDescription: '¿Estás seguro de que querés eliminar este pagador? Esta acción no se puede deshacer.',
    deleteConfirm: 'Eliminar',
    blockedTitle: (name: string) => `No se puede eliminar ${name}`,
    blockedHasRules: 'Este pagador tiene reglas de honorarios asociadas y no se puede eliminar.',
    understood: 'Entendido',
    deleted: 'Pagador eliminado',
    deleteError: 'No pudimos eliminar el pagador. Probá de nuevo.',
} as const

/** Etiquetas de los splits que arma PayerRulesManager (forma única del motor, #40). */
export const PAYER_SPLIT_LABELS = {
    professional: 'Profesional',
    organization: 'Organización',
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
    // 429 del login (feature 012). `{n}` se reemplaza por los minutos aproximados.
    rateLimited: 'Demasiados intentos. Esperá unos minutos antes de volver a intentar.',
    retryInMinute: 'Probá de nuevo en 1 minuto.',
    retryInMinutes: 'Probá de nuevo en {n} minutos.',
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
