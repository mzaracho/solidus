export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY = /pass|token|secret|jwt|authorization|cookie|api[-_]?key/i;
const MAX_DEPTH = 8;

/**
 * Copia en profundidad reemplazando por `[REDACTED]` el valor de toda clave sensible
 * (password, token, accessToken, secret, jwt, authorization, cookie, apiKey y variantes),
 * a cualquier nivel de anidamiento y dentro de arrays. No muta el original.
 */
export function redactSensitive(value: unknown): unknown {
  return redact(value, 0, new WeakSet<object>());
}

function redact(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redact(item, depth + 1, seen));
    }
    if (value instanceof Date) return value.toISOString();
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : redact(val, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/** Serializa un valor ya redactado para loguearlo. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(redactSensitive(value));
  } catch {
    return '[unserializable]';
  }
}
