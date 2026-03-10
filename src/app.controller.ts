import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { AppService } from './app.service.js';
import { DbHealthIndicator } from './modules/health/db-health.indicator.js';
import { RedisHealthIndicator } from './modules/health/redis-health.indicator.js';
import { Public } from './modules/auth/decorators/public.decorator.js';

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
  getRoot() {
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
  @HealthCheck()
  getHealth() {
    return this.health.check([
      () => this.dbHealth.pingCheck('database'),
      () => this.redisHealth.pingCheck('redis'),
    ]);
  }
}
