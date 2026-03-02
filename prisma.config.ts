// Prisma v7 CLI configuration file.
// Provides the database connection for `prisma migrate` and `prisma db` commands.
// Runtime connection is handled separately via PrismaPg adapter in PrismaService.
// See: https://pris.ly/d/config-datasource

import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});

