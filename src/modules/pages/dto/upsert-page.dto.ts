import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  Min,
  ValidateNested,
} from 'class-validator';
import { SectionType } from '../../../generated/prisma/enums.js';

/**
 * A single page section to upsert.
 * The `data` field is a JSONB payload validated server-side by Zod
 * per SectionType (see `schemas/section-data.schema.ts`).
 */
export class SectionInputDto {
  @ApiProperty({ enum: Object.values(SectionType), type: String, example: SectionType.HERO })
  @IsEnum(SectionType)
  type!: SectionType;

  @ApiProperty({
    example: 0,
    minimum: 0,
    description: 'Display order (0-based, must be unique within page)',
  })
  @IsInt()
  @Min(0)
  order!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Section content payload. Shape is validated by Zod per SectionType.',
    example: { title: 'Welcome', subtitle: 'Build something great' },
  })
  @IsObject()
  data!: Record<string, unknown>;
}

/**
 * PUT /admin/content/pages/:slug body.
 * Performs a full replace of all page sections — existing sections are
 * deleted and the provided list is inserted atomically in a transaction.
 * An empty array clears all sections (page remains in current status).
 */
export class UpsertPageDto {
  @ApiProperty({
    type: [SectionInputDto],
    description:
      'Complete replacement section list. All existing sections are replaced atomically.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(50)
  @Type(() => SectionInputDto)
  sections!: SectionInputDto[];
}
