import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class UpdatePageDto {
  @ApiProperty({
    example: 'Акционерам и инвесторам',
    description: 'New human-readable page title',
  })
  @IsString()
  @Length(1, 200)
  name!: string;
}
