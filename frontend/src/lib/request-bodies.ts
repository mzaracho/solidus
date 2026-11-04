// Bodies y queries que el front manda a la API (feature 014). El backend rechaza con 400 los campos que su DTO no
// declara (whitelist + forbidNonWhitelisted en bodies), asi que cada escritura arma su body con una lista
// explicita de campos, que espeja el DTO del endpoint. Modulo puro y sin imports para probarlo con `node --test`.
// Si cambia un DTO del backend, cambia la lista de aca y el fixture backend/test/fixtures/frontend-request-bodies.json.

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}

/** Copia solo las claves indicadas y omite las undefined (null y '' se conservan: el backend los acepta). */
export function pickDefined(obj: unknown, keys: readonly string[]): Json {
  const source = asRecord(obj)
  const out: Json = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/**
 * Quita los numericos que no son number finito (NaN de un input vacio, '' del formulario, null): la clave
 * desaparece del body en lugar de viajar como null/''. Efecto conocido: `alertsDays` vacio ya no se guarda como
 * `null` sino ausente (la UI lo lee igual: `alertsDays || 60`). El monto de una atencion lo valida
 * WorkItemForm.handleSubmit antes de armar el body.
 */
function withFiniteNumbers(body: Json, keys: readonly string[]): Json {
  for (const key of keys) {
    if (key in body && !(typeof body[key] === 'number' && Number.isFinite(body[key]))) delete body[key]
  }
  return body
}

// ─── Listas de campos (espejan los DTO del backend) ───────────────────────────
export const ACTIVITY_CREATE_FIELDS = [
  'organizationId', 'date', 'patientId', 'professionalId', 'participants', 'activityTypeId', 'presetId', 'payerId',
  'role', 'serviceType', 'hours', 'quantity', 'paymentStatus', 'paymentMethod', 'paymentDate', 'amount',
  'amountBase', 'amountCard', 'attendance',
] as const
export const ACTIVITY_PARTICIPANT_FIELDS = ['professionalId', 'roleLabel'] as const
export const ACTIVITY_UPDATE_FIELDS = ['date', 'paymentStatus', 'paymentMethod', 'paymentDate', 'attendance'] as const
export const STAFF_CREATE_FIELDS = [
  'name', 'surname', 'cuit', 'email', 'phone', 'canLoadActivities', 'categoryId',
] as const
export const STAFF_UPDATE_FIELDS = ['name', 'surname', 'cuit', 'email', 'phone', 'canLoadActivities'] as const
export const PATIENT_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const
export const ORG_UPDATE_FIELDS = ['name', 'cuit', 'address', 'settings'] as const
export const ORG_SETTINGS_FIELDS = [
  'alertsDays', 'emailNotifs', 'privatePayerName', 'proModePrivatePatientPct', 'defaultServiceType',
  'defaultEventRole', 'admisionNoCoAdmisorBehavior',
] as const
export const PRO_PROFILE_FIELDS = ['displayName', 'cuit', 'phone', 'email'] as const
export const FEE_RULE_FIELDS = [
  'name', 'payerId', 'payer', 'professionalCategory', 'serviceType', 'conditionProfessionalRole', 'splits',
  'validFrom', 'validTo',
] as const
export const PRESET_FIELDS = ['name', 'baseValue', 'cardValue', 'linkedType'] as const
export const ACTIVITY_TYPE_CREATE_FIELDS = ['code', 'name', 'baseValue', 'cardValue', 'roles'] as const
export const ACTIVITY_TYPE_UPDATE_FIELDS = ['name', 'baseValue', 'cardValue', 'roles'] as const
export const ACTIVITY_TYPE_ROLE_FIELDS = ['roleLabel', 'isRequired', 'feeStrategy', 'fixedPercentage'] as const
export const WORK_ITEMS_FILTER_FIELDS = ['startDate', 'endDate', 'type', 'status', 'patientId'] as const

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * POST activity. Recibe el estado completo de WorkItemForm (sin `mode`, que viaja en el header x-mode).
 * `gross` es un alias de `amount` que el backend ya no recibe: si falta `amount`, se usa `gross`.
 */
export function buildCreateActivityBody(data: unknown): Json {
  const source = asRecord(data)
  const body = pickDefined(source, ACTIVITY_CREATE_FIELDS)
  if (body.amount === undefined && source.gross !== undefined) body.amount = source.gross
  if (Array.isArray(source.participants)) {
    body.participants = source.participants.map((p) => pickDefined(p, ACTIVITY_PARTICIPANT_FIELDS))
  }
  return withFiniteNumbers(body, ['hours', 'quantity', 'amount', 'amountBase', 'amountCard'])
}

/** PUT activity/:id. Descarta lo que el backend nunca persistio (grossAmount, payerName, etc.). */
export function buildUpdateActivityBody(data: unknown): Json {
  return pickDefined(data, ACTIVITY_UPDATE_FIELDS)
}

/** POST org/staff. */
export function buildStaffCreateBody(data: unknown): Json {
  return pickDefined(data, STAFF_CREATE_FIELDS)
}

/** PUT org/staff/:id (la categoria va por PUT org/staff/:id/category). */
export function buildStaffUpdateBody(data: unknown): Json {
  return pickDefined(data, STAFF_UPDATE_FIELDS)
}

/** POST v1/patients y PUT v1/patients/:id (la organizacion la pone el backend). */
export function buildPatientBody(data: unknown): Json {
  return pickDefined(data, PATIENT_FIELDS)
}

/** PUT org. `settings` solo con las claves que declara OrgSettingsDto. */
export function buildOrgUpdateBody(data: unknown): Json {
  const body = pickDefined(data, ORG_UPDATE_FIELDS)
  if (body.settings !== undefined) {
    const settings = pickDefined(body.settings, ORG_SETTINGS_FIELDS)
    body.settings = withFiniteNumbers(settings, ['alertsDays', 'proModePrivatePatientPct'])
  }
  return body
}

/** PUT pro/profile. */
export function buildProProfileBody(data: unknown): Json {
  return pickDefined(data, PRO_PROFILE_FIELDS)
}

/** POST fee-rules (crea o actualiza la regla del pagador). Descarta `organization`: la organizacion la pone el backend. */
export function buildFeeRuleBody(data: unknown): Json {
  const source = asRecord(data)
  const body = pickDefined(source, FEE_RULE_FIELDS)
  if (source.payer !== undefined) {
    const connectId = asRecord(asRecord(source.payer).connect).id
    body.payer = connectId === undefined ? {} : { connect: { id: connectId } }
  }
  return body
}

/** POST org/presets y PUT org/presets/:id. */
export function buildPresetBody(data: unknown): Json {
  return withFiniteNumbers(pickDefined(data, PRESET_FIELDS), ['baseValue', 'cardValue'])
}

/** POST org/activity-types (con `code`) y PUT org/activity-types/:id (sin `code`: el update nunca lo cambio). */
export function buildActivityTypeBody(data: unknown, kind: 'create' | 'update'): Json {
  const source = asRecord(data)
  const body = pickDefined(source, kind === 'create' ? ACTIVITY_TYPE_CREATE_FIELDS : ACTIVITY_TYPE_UPDATE_FIELDS)
  if (Array.isArray(source.roles)) {
    // Los roles guardados pueden traer claves de mas: solo las 4 que declara ActivityTypeRoleDto
    body.roles = source.roles.map((role) =>
      withFiniteNumbers(pickDefined(role, ACTIVITY_TYPE_ROLE_FIELDS), ['fixedPercentage']),
    )
  }
  return withFiniteNumbers(body, ['baseValue', 'cardValue'])
}

/**
 * Query de GET activity. `mode` lo lee ViewModeGuard (no esta en el DTO). Mapea `payer` a `payerId` y `patient` a
 * `search`; cualquier otra clave de `filters` se descarta.
 */
export function buildWorkItemsQuery(
  mode: string,
  filters: unknown,
  page: number,
  limit: number,
): Record<string, string> {
  const query: Record<string, string> = { mode, page: String(page), limit: String(limit) }
  const source = asRecord(filters)
  const set = (key: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') query[key] = String(value)
  }
  for (const key of WORK_ITEMS_FILTER_FIELDS) set(key, source[key])
  set('payerId', source.payer ?? source.payerId)
  set('search', source.patient ?? source.search)
  return query
}
