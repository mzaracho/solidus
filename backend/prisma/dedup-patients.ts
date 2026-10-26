/**
 * Script: dedup-patients.ts
 *
 * Unifica pacientes duplicados dentro de la misma organización.
 * Criterio de duplicado: mismo firstName y lastName (sin distinción de mayúsculas).
 * Estrategia: conserva el registro más antiguo (createdAt más temprano),
 * reasigna sus workItems, normaliza el nombre a TitleCase y elimina los duplicados.
 *
 * Ejecutar desde backend/:
 *   npx ts-node -r tsconfig-paths/register prisma/dedup-patients.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function toTitleCase(name: string): string {
  return name
    .trim()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function main() {
  console.log('🔍  Buscando pacientes duplicados...\n');

  const allPatients = await prisma.patient.findMany({
    orderBy: { createdAt: 'asc' },
  });

  // Agrupar por organizationId + nombre normalizado
  const groups = new Map<string, typeof allPatients>();
  for (const p of allPatients) {
    const key = `${p.organizationId}::${p.firstName.trim().toLowerCase()}::${p.lastName.trim().toLowerCase()}`;
    const group = groups.get(key) ?? [];
    group.push(p);
    groups.set(key, group);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);

  if (duplicateGroups.length === 0) {
    console.log('✅  No se encontraron duplicados.');
    return;
  }

  console.log(`⚠️  Se encontraron ${duplicateGroups.length} grupo(s) con duplicados:\n`);

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const group of duplicateGroups) {
    // El más antiguo es el primero (ordenamos por createdAt asc arriba)
    const [keeper, ...dupes] = group;
    const normalizedFirst = toTitleCase(keeper.firstName);
    const normalizedLast = toTitleCase(keeper.lastName);

    console.log(`  Grupo: "${keeper.firstName} ${keeper.lastName}"`);
    console.log(`  → Conservar: ${keeper.id} (${keeper.createdAt.toISOString()})`);
    for (const d of dupes) {
      console.log(`  → Eliminar:  ${d.id}  ("${d.firstName} ${d.lastName}", ${d.createdAt.toISOString()})`);
    }

    const dupeIds = dupes.map((d) => d.id);

    await prisma.$transaction(async (tx) => {
      // 1. Reasignar workItems de los duplicados al keeper
      const { count } = await tx.workItem.updateMany({
        where: { patientId: { in: dupeIds } },
        data: { patientId: keeper.id },
      });
      totalMerged += count;

      // 2. Normalizar nombre del keeper
      await tx.patient.update({
        where: { id: keeper.id },
        data: { firstName: normalizedFirst, lastName: normalizedLast },
      });

      // 3. Eliminar los duplicados
      await tx.patient.deleteMany({
        where: { id: { in: dupeIds } },
      });
      totalDeleted += dupeIds.length;
    });

    console.log(`  ✔  ${dupes.length} duplicado(s) eliminados, nombre normalizado a "${normalizedFirst} ${normalizedLast}"\n`);
  }

  console.log(`\n✅  Listo. ${totalDeleted} paciente(s) eliminados, ${totalMerged} workItem(s) reasignados.`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
