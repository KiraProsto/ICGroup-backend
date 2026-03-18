import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query parameters for the dedicated FTS search endpoint.
 * The `q` field is required and treated as plain text — `websearch_to_tsquery`
 * handles both plain input and optional web-search operators (+, -, "phrase").
 */
export class SearchNewsQueryDto {
  @ApiProperty({
    example: 'финансовые результаты',
    description:
      'Plain-text search query. Supports websearch-style operators: ' +
      '"exact phrase", -exclude, OR. Maximum 500 characters.',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  q!: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number = 20;
}
