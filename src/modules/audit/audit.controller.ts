import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuditService } from './audit.service.js';
import { ListAuditQueryDto } from './dto/list-audit-query.dto.js';
import { AuditLogResponseDto } from './dto/audit-log-response.dto.js';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import { ApiPaginatedResponseDto, ApiErrorResponseDto } from '../../common/dto/api-response.dto.js';

/**
 * Audit log read endpoint — SUPER_ADMIN only.
 *
 * CASL policy: `manage AuditLog` — only SUPER_ADMIN has `manage all`,
 * so CONTENT_MANAGER's `read AuditLog` does NOT satisfy this guard,
 * ensuring the audit trail is visible only to super-administrators.
 *
 * The response intentionally omits beforeSnapshot / afterSnapshot / metadata
 * to keep list payload sizes manageable. A separate detail endpoint can be
 * added later if per-entry snapshot inspection is required.
 */
@ApiTags('admin/audit')
@ApiBearerAuth('access-token')
@Controller('admin/audit')
@CheckPolicies((ability) => ability.can('manage', 'AuditLog'))
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // ─── GET /admin/audit ──────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List audit log entries (paginated). SUPER_ADMIN only.',
    description:
      'Returns a paginated list of audit log entries. ' +
      'Supports filtering by actorId, action, resourceType, dateFrom, and dateTo. ' +
      'Heavy snapshot columns (before/after JSON) are excluded from list responses.',
  })
  @ApiOkResponse({ type: ApiPaginatedResponseDto(AuditLogResponseDto) })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findAll(@Query() query: ListAuditQueryDto) {
    return this.auditService.findAll(query);
  }
}
