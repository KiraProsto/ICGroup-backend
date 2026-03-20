import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

/**
 * PATCH /admin/content/news/:articleId/cards/:cardId
 *
 * Note: card `type` is immutable after creation — changing the type would
 * silently invalidate the existing data payload.
 */
export class UpdateCardDto {
  @ApiPropertyOptional({
    minimum: 0,
    description: 'New position in the ordered card list (0-based).',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Updated card content payload. Must match the shape for the card type.',
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, unknown>;
}
