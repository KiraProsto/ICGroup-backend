import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class CreatePageDto {
  @ApiProperty({
    example: 'shareholders',
    description: 'URL-safe slug: 1–100 lowercase letters, digits, or hyphens',
  })
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$/, {
    message:
      'slug must start and end with a letter or digit, contain only lowercase letters, digits, or hyphens (1–100 chars)',
  })
  slug!: string;

  @ApiProperty({
    example: 'Акционерам и инвесторам',
    description: 'Human-readable page title displayed in the admin panel',
  })
  @IsString()
  @Length(1, 200)
  name!: string;
}
