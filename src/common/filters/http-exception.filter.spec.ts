import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './http-exception.filter.js';

describe('AllExceptionsFilter', () => {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();

  const response = {
    status,
    json,
  };

  const request = {
    method: 'GET',
    url: '/api/v1/items?token=secret',
    path: '/api/v1/items',
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as never as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves structured HttpException details and sanitizes the response path', () => {
    const filter = new AllExceptionsFilter();
    const exception = new HttpException(
      {
        message: 'Rate limit exceeded',
        error: 'Too Many Requests',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryAfterSeconds: 60,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded',
        details: {
          error: 'Too Many Requests',
          retryAfterSeconds: 60,
        },
      },
      meta: {
        timestamp: expect.any(String),
        path: '/api/v1/items',
      },
    });
  });

  it('maps validation-style arrays to a stable message while preserving extra fields', () => {
    const filter = new AllExceptionsFilter();
    const exception = new HttpException(
      {
        message: ['email must be an email'],
        error: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: HttpStatus.BAD_REQUEST,
        message: 'Validation failed',
        details: {
          error: 'Bad Request',
          messages: ['email must be an email'],
        },
      },
      meta: {
        timestamp: expect.any(String),
        path: '/api/v1/items',
      },
    });
  });
});
