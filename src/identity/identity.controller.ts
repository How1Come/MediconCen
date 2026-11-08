import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ResolveIdentityDto } from './dto/resolve-identity.dto';
import { ResolvedIdentityDto } from './dto/resolved-identity.dto';
import { IdentityService } from './identity.service';

@ApiTags('Identity')
@Controller('users')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'resolveIdentity',
    summary: 'Resolve an ordered identifier pair to a persistent user ID',
    description:
      'Returns the stored UUID for an existing pair or persists a new UUID v4 before returning it. Concurrent first requests converge on the database winner. Identifier order, case, whitespace, and Unicode normalization are significant.',
  })
  @ApiConsumes('application/json')
  @ApiProduces('application/json')
  @ApiBody({ type: ResolveIdentityDto, required: true })
  @ApiOkResponse({
    description: 'The persisted mapping for either a new or an existing pair.',
    type: ResolvedIdentityDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid identifiers, unsupported properties, or malformed JSON.',
    type: ApiErrorDto,
    examples: {
      validation: {
        summary: 'An identifier contains only whitespace',
        value: {
          statusCode: 400,
          error: 'Bad Request',
          message: ['id1 must contain a non-whitespace character'],
        },
      },
      malformedJson: {
        summary: 'The request body is not valid JSON',
        value: {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Invalid request body',
        },
      },
    },
  })
  @ApiPayloadTooLargeResponse({
    description: 'The request body exceeds the parser limit, default 100kb.',
    type: ApiErrorDto,
    example: {
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Payload Too Large',
    },
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'The content encoding or charset is unsupported.',
    type: ApiErrorDto,
    example: {
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Unsupported Media Type',
    },
  })
  @ApiServiceUnavailableResponse({
    description:
      'A recognized transient database failure prevented resolution.',
    type: ApiErrorDto,
    example: {
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Service temporarily unavailable',
    },
  })
  @ApiInternalServerErrorResponse({
    description:
      'An unexpected failure occurred; internal details are omitted.',
    type: ApiErrorDto,
    example: {
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    },
  })
  resolve(@Body() dto: ResolveIdentityDto): Promise<ResolvedIdentityDto> {
    return this.identityService.resolve(dto.id1, dto.id2);
  }
}
