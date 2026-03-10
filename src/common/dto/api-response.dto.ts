import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger-typed DTOs for the unified response envelope:
 *   { success, data, meta }
 *
 * Usage in controllers:
 *
 *   @ApiResponse({ status: 200, type: ApiResponseDto(UserDto) })
 *   @ApiResponse({ status: 200, type: ApiPaginatedResponseDto(UserDto) })
 */

export class ApiMetaDto {
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/users' })
  path!: string;
}

export class ApiPaginatedMetaDto extends ApiMetaDto {
  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  perPage!: number;

  @ApiProperty({ example: 5 })
  totalPages!: number;
}

export class ApiErrorDetailDto {
  @ApiProperty({ example: 400 })
  code!: number;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ required: false, type: [String] })
  details?: string[];
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: false })
  success!: boolean;

  @ApiProperty({ type: ApiErrorDetailDto })
  error!: ApiErrorDetailDto;

  @ApiProperty({ type: ApiMetaDto })
  meta!: ApiMetaDto;
}

/**
 * Returns a Swagger-annotated class that describes:
 *   { success: true, data: <DataClass>, meta: { timestamp, path } }
 *
 * @example
 *   @ApiOkResponse({ type: ApiResponseDto(UserDto) })
 */

export function ApiResponseDto<T extends object>(DataClass: new (...args: unknown[]) => T) {
  class Wrapper {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: DataClass })
    data!: T;

    @ApiProperty({ type: ApiMetaDto })
    meta!: ApiMetaDto;
  }

  Object.defineProperty(Wrapper, 'name', {
    value: `ApiResponseDto_${DataClass.name}`,
  });

  return Wrapper;
}

/**
 * Returns a Swagger-annotated class that describes a paginated list response:
 *   { success: true, data: <DataClass>[], meta: { timestamp, path, total, page, perPage, totalPages } }
 *
 * @example
 *   @ApiOkResponse({ type: ApiPaginatedResponseDto(UserDto) })
 */

export function ApiPaginatedResponseDto<T extends object>(
  DataClass: new (...args: unknown[]) => T,
) {
  class PaginatedWrapper {
    @ApiProperty({ example: true })
    success!: boolean;

    @ApiProperty({ type: DataClass, isArray: true })
    data!: T[];

    @ApiProperty({ type: ApiPaginatedMetaDto })
    meta!: ApiPaginatedMetaDto;
  }

  Object.defineProperty(PaginatedWrapper, 'name', {
    value: `ApiPaginatedResponseDto_${DataClass.name}`,
  });

  return PaginatedWrapper;
}
