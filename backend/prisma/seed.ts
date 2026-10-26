/**
 * @deprecated This TypeScript seed file has been replaced by seed.sql in the project root.
 * Use: Get-Content ../seed.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db
 * 
 * Before seeding, truncate: Get-Content ../truncate.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('⚠️  This seed file is deprecated. Please use seed.sql in the project root instead.');
  console.log('Run: Get-Content ../seed.sql | docker exec -i healthops-gem-db-1 psql -U myuser -d solidus_db');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
