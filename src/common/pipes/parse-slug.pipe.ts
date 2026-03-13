import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Matches the slug format enforced by CreatePageDto: 1–100 lowercase letters, digits, or hyphens. */
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/;

/**
 * Validates a URL path parameter as a well-formed slug.
 * Returns a 400 Bad Request for any value that does not match the format,
 * preventing garbage input from reaching the database query layer.
 */
@Injectable()
export class ParseSlugPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!SLUG_RE.test(value)) {
      throw new BadRequestException(
        `Invalid slug: must contain only lowercase letters, digits, or hyphens (1–100 chars)`,
      );
    }
    return value;
  }
}
