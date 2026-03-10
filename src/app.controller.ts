import { Controller, Get } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { AppService } from './app.service.js';
import { DbHealthIndicator } from './modules/health/db-health.indicator.js';
import { RedisHealthIndicator } from './modules/health/redis-health.indicator.js';
import { Public } from './modules/auth/decorators/public.decorator.js';
import { AppInfoDto } from './common/dto/app-info.dto.js';
import { ApiErrorResponseDto, ApiResponseDto } from './common/dto/api-response.dto.js';

@ApiTags('meta')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthCheckService,
    private readonly dbHealth: DbHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Root — API info' })
  @ApiOkResponse({ type: ApiResponseDto(AppInfoDto) })
  getRoot(): AppInfoDto {
    return this.appService.getInfo();
  }

  /**
   * Liveness/readiness probe — excluded from the global 'api' prefix so it is
   * reachable at GET /health (used by Docker HEALTHCHECK and load balancers).
   * Returns 200 only when both PostgreSQL and Redis are reachable.
   */
  @Get('health')
  @Public()
  @ApiExcludeEndpoint()
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  @HealthCheck()
  getHealth() {
    return this.health.check([
      () => this.dbHealth.pingCheck('database'),
      () => this.redisHealth.pingCheck('redis'),
    ]);
  }
}
