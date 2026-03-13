import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class UpdatePageDto {
  @ApiProperty({
    example: 'Акционерам и инвесторам',
    description: 'New human-readable page title',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  name!: string;
}
