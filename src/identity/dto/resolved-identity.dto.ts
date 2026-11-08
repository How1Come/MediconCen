import { ApiProperty } from '@nestjs/swagger';

export class ResolvedIdentityDto {
  @ApiProperty({
    description: 'The persisted UUID v4 associated with the ordered pair.',
    format: 'uuid',
    pattern:
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  userID!: string;
}
