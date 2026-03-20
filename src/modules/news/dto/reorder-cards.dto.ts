import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/**
 * PUT /admin/content/news/:articleId/cards/order
 *
 * Accepts a complete ordered list of card IDs.  The service replaces the
 * current order with the positions implied by array index.
 * All IDs must belong to the specified article; any missing or foreign IDs
 * result in a 400 Bad Request.
 */
export class ReorderCardsDto {
  @ApiProperty({
    type: [String],
    example: ['card-uuid-3', 'card-uuid-1', 'card-uuid-2'],
    description:
      'Complete ordered array of card UUIDs for the article. ' +
      'Position in the array determines the new `order` value (0-based).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  cardIds!: string[];
}
