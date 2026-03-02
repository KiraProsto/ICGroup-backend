import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('meta')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Root — API info' })
  getRoot() {
    return this.appService.getInfo();
  }

  /**
   * Liveness probe — excluded from the global 'api' prefix so it is
   * reachable at GET /health (used by Docker HEALTHCHECK and load balancers).
   */
  @Get('health')
  @ApiExcludeEndpoint()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
