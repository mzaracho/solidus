// Errores de la API (feature 013). El backend responde { code, errors: [{ message }] } sin `details`.
// Este modulo arma el mensaje que ve el usuario: el de negocio del backend en los 4xx, o uno generico en
// espanol segun el status. Nunca muestra JSON crudo ni el cuerpo de la respuesta.
import { API_ERROR_CODE, API_ERROR_MESSAGES } from './constants.ts'

const MAX_MESSAGE_LENGTH = 300

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

const genericForStatus = (status: number): string => {
  switch (status) {
    case 400:
      return API_ERROR_MESSAGES.badRequest
    case 409:
      return API_ERROR_MESSAGES.conflict
    case 413:
      return API_ERROR_MESSAGES.payloadTooLarge
    case 429:
      return API_ERROR_MESSAGES.tooManyRequests
    default:
      return API_ERROR_MESSAGES.generic
  }
}

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

const firstErrorMessage = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const errors = (body as { errors?: unknown }).errors
  if (!Array.isArray(errors) || errors.length === 0) return null
  const first: unknown = errors[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  return typeof message === 'string' && message.trim().length > 0 ? message : null
}

/**
 * Mensaje para el usuario a partir del status y del cuerpo (ya parseado, o null) de una respuesta de error.
 * Solo lee `errors[0].message`: ignora `details` y el `message` de nivel superior.
 */
export function messageFromErrorBody(status: number, body: unknown): string {
  if (status >= 500) return API_ERROR_MESSAGES.server
  if (status === 404) return API_ERROR_MESSAGES.notFound
  if (codeOf(body) === API_ERROR_CODE.VALIDATION_FAILED) return API_ERROR_MESSAGES.validation
  const message = firstErrorMessage(body)
  if (message) return message.slice(0, MAX_MESSAGE_LENGTH)
  return genericForStatus(status)
}

/** Convierte una respuesta no exitosa en un ApiRequestError con el mensaje para el usuario. */
export async function toApiError(res: Response): Promise<ApiRequestError> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return new ApiRequestError(res.status, codeOf(body), messageFromErrorBody(res.status, body))
}

/** El mensaje de un ApiRequestError; para cualquier otro error (red, programacion) el `fallback`. */
export function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback
}
