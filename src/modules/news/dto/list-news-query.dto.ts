import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContentStatus, ArticleType } from '../../../generated/prisma/enums.js';

export class ListNewsQueryDto {
  @ApiPropertyOptional({ enum: ContentStatus, description: 'Filter by lifecycle status' })
  @IsEnum(ContentStatus)
  @IsOptional()
  status?: ContentStatus;

  @ApiPropertyOptional({ enum: ArticleType, description: 'Filter by article type' })
  @IsEnum(ArticleType)
  @IsOptional()
  articleType?: ArticleType;

  @ApiPropertyOptional({ description: 'Filter by rubric UUID' })
  @IsUUID()
  @IsOptional()
  rubricId?: string;

  @ApiPropertyOptional({ description: 'Full-text search query', example: 'цифровая экономика' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  perPage?: number;
}
