import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { AppService } from './app.service.js';
import {
  DbHealthIndicator,
  RedisHealthIndicator,
  StorageHealthIndicator,
} from './modules/health/index.js';
import { Public } from './modules/auth/decorators/public.decorator.js';
import { AppInfoDto } from './common/dto/app-info.dto.js';
import { ApiResponseDto } from './common/dto/api-response.dto.js';

@ApiTags('meta')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthCheckService,
    private readonly dbHealth: DbHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly storageHealth: StorageHealthIndicator,
  ) {}

  @Get()
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Root — API info' })
  @ApiOkResponse({ type: ApiResponseDto(AppInfoDto) })
  getRoot(): AppInfoDto {
    return this.appService.getInfo();
  }

  /**
   * Liveness/readiness probe — excluded from the global 'api' prefix so it is
   * reachable at GET /health (used by Docker HEALTHCHECK and load balancers).
   * Returns 200 only when PostgreSQL, Redis, and MinIO/S3 are reachable.
   */
  @Get('health')
  @Public()
  @SkipThrottle()
  @ApiExcludeEndpoint()
  @HealthCheck()
  getHealth() {
    return this.health.check([
      () => this.dbHealth.pingCheck('database'),
      () => this.redisHealth.pingCheck('redis'),
      () => this.storageHealth.pingCheck('storage'),
    ]);
  }
}
