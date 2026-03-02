import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * PrismaModule — global module that provides PrismaService to every feature
 * module without requiring explicit imports in each one.
 *
 * Marked @Global() so that PrismaService is available application-wide after
 * a single import in AppModule.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
