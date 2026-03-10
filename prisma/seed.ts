/**
 * Database seed — idempotent, safe to run multiple times.
 *
 * Creates or updates the default SUPER_ADMIN user with a proper Argon2id hash.
 * Run via:  npm run prisma:seed
 */

import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ── Seed data ─────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'sudebovds@gmail.com';
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? '615772615772';

async function main() {
  console.log('Seeding database...');

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, isActive: true, deletedAt: null },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
    select: { id: true, email: true, role: true },
  });

  console.log(`✓ SUPER_ADMIN seeded: id=${user.id}  email=${user.email}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect?.();
    await pool.end();
  });
