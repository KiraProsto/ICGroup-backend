import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheckService } from '@nestjs/terminus';
import request from 'supertest';
import { AppController } from '../src/app.controller.js';
import { configureApp } from '../src/app.setup.js';
import { AppService } from '../src/app.service.js';
import { DbHealthIndicator } from '../src/modules/health/db-health.indicator.js';
import { RedisHealthIndicator } from '../src/modules/health/redis-health.indicator.js';
import { StorageHealthIndicator } from '../src/modules/health/storage-health.indicator.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  const healthCheckService = {
    check: jest.fn(),
  };

  const dbHealthIndicator = {
    pingCheck: jest.fn(),
  };

  const redisHealthIndicator = {
    pingCheck: jest.fn(),
  };

  const storageHealthIndicator = {
    pingCheck: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: HealthCheckService,
          useValue: healthCheckService,
        },
        {
          provide: DbHealthIndicator,
          useValue: dbHealthIndicator,
        },
        {
          provide: RedisHealthIndicator,
          useValue: redisHealthIndicator,
        },
        {
          provide: StorageHealthIndicator,
          useValue: storageHealthIndicator,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1 — returns API info wrapped in success envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .expect(200)
      .expect((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.name).toBe('ICGroup API');
        expect(res.body.data.status).toBe('ok');
        expect(res.body.meta).toMatchObject({
          path: '/api/v1',
          timestamp: expect.any(String),
        });
      });
  });

  it('GET missing route — returns wrapped error with sanitized path metadata', () => {
    return request(app.getHttpServer())
      .get('/api/v1/does-not-exist?token=secret')
      .expect(404)
      .expect((res) => {
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe(404);
        expect(res.body.meta).toMatchObject({
          path: '/api/v1/does-not-exist',
          timestamp: expect.any(String),
        });
      });
  });

  it('GET /health — returns 200 when all indicators are healthy', () => {
    healthCheckService.check.mockImplementation((indicators: Array<() => Promise<unknown>>) =>
      Promise.all(indicators.map((fn) => fn())).then(() => ({
        status: 'ok',
        info: {
          database: { status: 'up' },
          redis: { status: 'up' },
          storage: { status: 'up' },
        },
      })),
    );
    dbHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    redisHealthIndicator.pingCheck.mockResolvedValue({ redis: { status: 'up' } });
    storageHealthIndicator.pingCheck.mockResolvedValue({ storage: { status: 'up' } });

    // The health endpoint is excluded from the global 'api' prefix AND is
    // VERSION_NEUTRAL so it resolves at /health — matching Docker HEALTHCHECK.
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        // Health response bypasses the envelope — raw Terminus JSON.
        expect(res.body.status).toBe('ok');
        expect(res.body.info).toEqual(
          expect.objectContaining({
            database: { status: 'up' },
            redis: { status: 'up' },
            storage: { status: 'up' },
          }),
        );
        expect(dbHealthIndicator.pingCheck).toHaveBeenCalledWith('database');
        expect(redisHealthIndicator.pingCheck).toHaveBeenCalledWith('redis');
        expect(storageHealthIndicator.pingCheck).toHaveBeenCalledWith('storage');
      });
  });

  it('GET /health — returns 503 when a dependency is down', () => {
    const errorBody = {
      status: 'error',
      info: { database: { status: 'up' }, storage: { status: 'up' } },
      error: { redis: { status: 'down', message: 'Redis unreachable' } },
    };
    healthCheckService.check.mockRejectedValue(new ServiceUnavailableException(errorBody));
    dbHealthIndicator.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    redisHealthIndicator.pingCheck.mockResolvedValue({
      redis: { status: 'down', message: 'Redis unreachable' },
    });
    storageHealthIndicator.pingCheck.mockResolvedValue({ storage: { status: 'up' } });

    return request(app.getHttpServer()).get('/health').expect(503);
  });
});
