import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { ArticleCardType } from '../../../generated/prisma/enums.js';

export class CreateCardDto {
  @ApiProperty({
    enum: ArticleCardType,
    example: 'TEXT',
    description: 'Card type — determines the shape of the data payload',
  })
  @IsEnum(ArticleCardType)
  type!: ArticleCardType;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Insertion order (0-based). If omitted, the card is appended at the end of the list.',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Card content payload — shape depends on `type`. Validated server-side by Zod.\n' +
      '  TEXT:        { body: JSONContent }   — Tiptap ProseMirror document\n' +
      '  QUOTE:       { text: string }\n' +
      '  PUBLICATION: { articleId: string }   — UUID of referenced NewsArticle\n' +
      '  IMAGE:       { url: string; caption?: string }\n' +
      '  VIDEO:       { url: string; caption?: string }',
  })
  @IsObject()
  data!: Record<string, unknown>;
}
