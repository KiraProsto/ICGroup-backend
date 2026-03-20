import { PartialType } from '@nestjs/swagger';
import { CreateNewsDto } from './create-news.dto.js';

/**
 * All fields from CreateNewsDto are optional in an update.
 * PartialType preserves Swagger and class-validator decorators.
 */
export class UpdateNewsDto extends PartialType(CreateNewsDto) {}
