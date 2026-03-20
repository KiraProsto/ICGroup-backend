import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditService } from './audit.service.js';
import { AuditProcessor } from './audit.processor.js';
import { AuditInterceptor } from './interceptors/audit.interceptor.js';
import { AUDIT_QUEUE_NAME } from './audit.constants.js';

/**
 * AuditModule provides synchronous and asynchronous audit-log writing.
 *
 * The BullMQ queue is registered here; the root BullModule.forRootAsync()
 * connection config lives in AppModule.
 *
 * Exports AuditService so feature modules (Users, Content, Sales) can
 * record audit events without taking on a direct dependency on BullMQ or
 * the audit_logs table.
 */
@Module({
  imports: [BullModule.registerQueue({ name: AUDIT_QUEUE_NAME })],
  providers: [AuditService, AuditProcessor, AuditInterceptor],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
