// Seleccion y cobro de varias atenciones (feature 017, MAYOR-2). Modulo puro (sin React) para probarlo con
// `node --test`. La seleccion se guarda por ID de la atencion (no por indice de fila): si la tabla se recarga y las
// filas se corren, la seleccion sigue apuntando a las mismas atenciones.

export type RowSelection = Record<string, boolean>

/** Elementos seleccionados, por id (ignora ids que ya no estan en los datos). */
export function selectedById<T extends { id: string }>(data: readonly T[], selection: RowSelection): T[] {
  return data.filter((item) => selection[item.id] === true)
}

/** Deja en la seleccion solo ids que siguen en los datos (tras recargar o borrar). Devuelve el mismo objeto si no cambia nada. */
export function pruneSelection<T extends { id: string }>(selection: RowSelection, data: readonly T[]): RowSelection {
  const present = new Set(data.map((item) => item.id))
  let changed = false
  const next: RowSelection = {}
  for (const [id, on] of Object.entries(selection)) {
    if (on && present.has(id)) next[id] = true
    else changed = true
  }
  return changed ? next : selection
}

/** Saca de la seleccion los ids indicados (por ejemplo las ya cobradas). */
export function removeFromSelection(selection: RowSelection, ids: readonly string[]): RowSelection {
  const drop = new Set(ids)
  const next: RowSelection = {}
  for (const [id, on] of Object.entries(selection)) if (on && !drop.has(id)) next[id] = true
  return next
}

/**
 * Cobra una lista de atenciones una por una con la misma fecha. Devuelve cuales se cobraron, cuales fallaron y el
 * ultimo error. Las ya cobradas no se vuelven a mandar: quien llama reintenta solo con `failed`.
 */
export async function payEach<T extends { id: string }>(
  targets: readonly T[],
  pay: (item: T) => Promise<unknown>,
): Promise<{ paid: T[]; failed: T[]; lastError: unknown }> {
  const paid: T[] = []
  const failed: T[] = []
  let lastError: unknown = null
  for (const item of targets) {
    try {
      await pay(item)
      paid.push(item)
    } catch (e) {
      failed.push(item)
      lastError = e
    }
  }
  return { paid, failed, lastError }
}
