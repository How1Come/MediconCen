import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ type: 'integer', minimum: 400, maximum: 599, example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    description:
      'Validation failures return an array of messages. Parser failures and server errors return a fixed string without internal details.',
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: ['id1 must contain a non-whitespace character'],
  })
  message!: string | string[];
}
