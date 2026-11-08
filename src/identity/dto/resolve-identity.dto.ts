import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { MaxCodePointLength } from './max-code-point-length.decorator';

export class ResolveIdentityDto {
  @IsString({ message: 'id1 must be a string' })
  @IsNotEmpty({ message: 'id1 is required and must not be empty' })
  @MaxCodePointLength(255)
  @Matches(/\S/u, { message: 'id1 must contain a non-whitespace character' })
  @Matches(/^[^\uD800-\uDFFF]*$/u, {
    message: 'id1 must contain valid Unicode characters',
  })
  id1!: string;

  @IsString({ message: 'id2 must be a string' })
  @IsNotEmpty({ message: 'id2 is required and must not be empty' })
  @MaxCodePointLength(255)
  @Matches(/\S/u, { message: 'id2 must contain a non-whitespace character' })
  @Matches(/^[^\uD800-\uDFFF]*$/u, {
    message: 'id2 must contain valid Unicode characters',
  })
  id2!: string;
}
