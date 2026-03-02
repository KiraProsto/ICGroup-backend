import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET / — returns API info', () => {
    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect((res) => {
        expect(res.body.name).toBe('ICGroup API');
        expect(res.body.status).toBe('ok');
      });
  });
});
