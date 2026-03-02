// Prisma v7 CLI configuration file.
// Provides the database connection for `prisma migrate` and `prisma db` commands.
// Runtime connection is handled separately via PrismaPg adapter in PrismaService.
// See: https://pris.ly/d/config-datasource

import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  migrate: {
    adapter: async () => {
      const connectionString = process.env['DATABASE_URL'];
      if (!connectionString) {
        throw new Error('DATABASE_URL environment variable is not set');
      }
      return new PrismaPg({ connectionString });
    },
  },
});
