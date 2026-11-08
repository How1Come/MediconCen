import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import { MaxCodePointLength } from './max-code-point-length.decorator';

@ApiSchema({
  description:
    'An ordered pair of identifiers. Values must contain valid Unicode and a non-whitespace character. Case, whitespace, and normalization are preserved; extra properties are rejected.',
})
export class ResolveIdentityDto {
  @ApiProperty({
    description: 'First identifier, limited to 255 Unicode code points.',
    example: 'ABC123',
    minLength: 1,
    maxLength: 255,
    pattern: '\\S',
  })
  @IsString({ message: 'id1 must be a string' })
  @IsNotEmpty({ message: 'id1 is required and must not be empty' })
  @MaxCodePointLength(255)
  @Matches(/\S/u, { message: 'id1 must contain a non-whitespace character' })
  @Matches(/^[^\uD800-\uDFFF]*$/u, {
    message: 'id1 must contain valid Unicode characters',
  })
  id1!: string;

  @ApiProperty({
    description: 'Second identifier, limited to 255 Unicode code points.',
    example: 'XYZ456',
    minLength: 1,
    maxLength: 255,
    pattern: '\\S',
  })
  @IsString({ message: 'id2 must be a string' })
  @IsNotEmpty({ message: 'id2 is required and must not be empty' })
  @MaxCodePointLength(255)
  @Matches(/\S/u, { message: 'id2 must contain a non-whitespace character' })
  @Matches(/^[^\uD800-\uDFFF]*$/u, {
    message: 'id2 must contain valid Unicode characters',
  })
  id2!: string;
}
