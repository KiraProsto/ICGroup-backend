import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
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
});
