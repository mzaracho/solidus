import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorResponse,
  MessageError,
} from '@src/domain/seed-work/error-response';
import { neutralizeUnsafeChars } from '../config/app/access-log';

/** Códigos de error de negocio propios de la API (los de autenticación están en `AUTH_ERROR_CODE`). */
export const API_ERROR_CODE = {
  BAD_REQUEST: 'bad-request',
  VALIDATION_FAILED: 'validation-failed',
  FIRST_LOAD_REQUIRED: 'first-load-required',
  CONFLICT: 'conflict',
  UNHANDLED: 'unhandled-exception',
  REQUEST_ERROR: 'request-error',
} as const;

/** Código y mensaje genérico (en español) por status. Los 5xx usan la entrada 500. */
export const GENERIC_ERRORS: Record<number, [string, string]> = {
  400: ['bad-request', 'La solicitud no es válida.'],
  401: ['unauthorized', 'No autorizado.'],
  403: ['forbidden', 'No tenés permiso para realizar esta acción.'],
  404: ['not-found', 'No se encontró el recurso.'],
  409: [
    'conflict',
    'La operación no se puede completar por el estado actual de los datos.',
  ],
  413: ['payload-too-large', 'El cuerpo de la solicitud es demasiado grande.'],
  415: [
    'unsupported-media-type',
    'El tipo de contenido o la codificación de la solicitud no están soportados.',
  ],
  429: [
    'too-many-requests',
    'Demasiadas solicitudes. Probá de nuevo más tarde.',
  ],
  500: [
    'unhandled-exception',
    'Ocurrió un error en la aplicación. Por favor, intentá más tarde.',
  ],
};
const OTHER_4XX: [string, string] = [
  'request-error',
  'La solicitud no pudo procesarse.',
];

export const MAX_VALIDATION_MESSAGES = 20;
const MAX_VALIDATION_MESSAGE_LENGTH = 200;
const MAX_BUSINESS_MESSAGE_LENGTH = 300;
const MAX_LOG_MESSAGE_LENGTH = 200;
const CODE_PATTERN = /^[a-z][a-z-]{0,40}$/;

export interface MappedError {
  status: number;
  body: ErrorResponse;
  /** true para 5xx: se registra como error y se devuelve `X-Error-Id`. */
  internal: boolean;
}

function genericFor(status: number): [string, string] {
  if (status >= 500) return GENERIC_ERRORS[500];
  return GENERIC_ERRORS[status] ?? OTHER_4XX;
}

function build(
  status: number,
  code: string,
  messages: string[],
  internal: boolean,
): MappedError {
  return {
    status,
    internal,
    body: new ErrorResponse(
      code,
      messages.map((m) => new MessageError(m)),
    ),
  };
}

function internalError(status: number, code?: string): MappedError {
  return build(
    status,
    code ?? GENERIC_ERRORS[500][0],
    [GENERIC_ERRORS[500][1]],
    true,
  );
}

function curatedCodeOf(responseBody: unknown): string | undefined {
  if (typeof responseBody === 'object' && responseBody !== null) {
    const code = (responseBody as { code?: unknown }).code;
    if (typeof code === 'string' && CODE_PATTERN.test(code)) return code;
  }
  return undefined;
}

function businessMessageOf(responseBody: unknown): string | undefined {
  if (typeof responseBody !== 'object' || responseBody === null) {
    return undefined;
  }
  const message = (responseBody as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.slice(0, MAX_BUSINESS_MESSAGE_LENGTH);
  }
  return undefined;
}

function validationMessagesOf(responseBody: unknown): string[] | undefined {
  if (typeof responseBody !== 'object' || responseBody === null) {
    return undefined;
  }
  const message = (responseBody as { message?: unknown }).message;
  if (!Array.isArray(message)) return undefined;
  return message
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
    .slice(0, MAX_VALIDATION_MESSAGES)
    .map((m) => m.slice(0, MAX_VALIDATION_MESSAGE_LENGTH));
}

function exposedClientStatusOf(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const e = exception as {
    status?: unknown;
    statusCode?: unknown;
    expose?: unknown;
  };
  const status = typeof e.status === 'number' ? e.status : e.statusCode;
  if (
    e.expose === true &&
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 499
  ) {
    return status;
  }
  return undefined;
}

function mapHttpException(exception: HttpException): MappedError {
  const status = exception.getStatus();
  const responseBody = exception.getResponse();
  const curated = curatedCodeOf(responseBody);

  if (status >= 500 || status < 400) {
    return internalError(status >= 500 ? status : 500, curated);
  }
  if (status === 401 || status === 403 || status === 404) {
    const [code, message] = genericFor(status);
    return build(status, curated ?? code, [message], false);
  }
  if (status === 400) {
    const messages = validationMessagesOf(responseBody);
    if (messages) {
      return build(
        400,
        API_ERROR_CODE.VALIDATION_FAILED,
        messages.length > 0 ? messages : [GENERIC_ERRORS[400][1]],
        false,
      );
    }
  }
  const [defaultCode, genericMessage] = genericFor(status);
  const message = curated ? businessMessageOf(responseBody) : undefined;
  return build(
    status,
    curated ?? defaultCode,
    [message ?? genericMessage],
    false,
  );
}

/**
 * Convierte cualquier excepción en el contrato único `{ code, errors: [{ message }] }`.
 * Nunca expone `details`, la excepción serializada, mensajes de Prisma ni nombres internos.
 * No lanza.
 */
export function mapException(exception: unknown): MappedError {
  try {
    if (exception instanceof HttpException) return mapHttpException(exception);
    const exposed = exposedClientStatusOf(exception);
    if (exposed !== undefined) {
      const [code, message] = genericFor(exposed);
      return build(exposed, code, [message], false);
    }
    return internalError(HttpStatus.INTERNAL_SERVER_ERROR);
  } catch {
    return internalError(HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

const PRISMA_CLASS_NAMES = new Set([
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientValidationError',
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
]);

function className(error: unknown): string | undefined {
  const name = (error as { constructor?: { name?: unknown } } | null)
    ?.constructor?.name;
  return typeof name === 'string' ? name : undefined;
}

export function isPrismaError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return true;
  }
  if (typeof error !== 'object' || error === null) return false;
  const name = className(error);
  return (
    (name !== undefined && PRISMA_CLASS_NAMES.has(name)) ||
    'clientVersion' in error
  );
}

/**
 * Descripción segura para el log. Para Prisma solo clase y código (nunca message, meta, clientVersion ni stack).
 * Para otros errores, nombre y mensaje acotado y sin saltos de línea. Un valor que no es Error no se serializa.
 */
export function describeForLog(error: unknown): string {
  try {
    if (isPrismaError(error)) {
      const name = neutralizeUnsafeChars(className(error) ?? 'PrismaError');
      const code = (error as { code?: unknown }).code;
      const safeName = name.slice(0, 80);
      return typeof code === 'string' && /^[A-Za-z0-9]{1,10}$/.test(code)
        ? `${safeName} prisma=${code}`
        : safeName;
    }
    if (error instanceof Error) {
      const name = neutralizeUnsafeChars(error.name).slice(0, 80);
      // No se reutiliza neutralizeUnsafeChars en el mensaje: reemplazaría también los espacios
      // (deja solo [!-~]) y volvería ilegible el texto; acá se conservan los espacios.
      const message = error.message
        .slice(0, MAX_LOG_MESSAGE_LENGTH)
        // eslint-disable-next-line no-control-regex -- se neutralizan justamente los caracteres de control
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?');
      return `${name}: ${message}`;
    }
    return `non-error ${typeof error}`;
  } catch {
    return 'unknown-error';
  }
}

export function formatErrorLogLine(
  id: string,
  method: string,
  path: string,
  status: number,
  description: string,
): string {
  return `error id=${id} ${method} ${path} ${status} ${description}`;
}
