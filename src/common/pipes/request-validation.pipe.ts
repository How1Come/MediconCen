import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';

class RequestValidationPipe extends ValidationPipe {
  override async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    if (
      metadata.type === 'body' &&
      typeof value === 'object' &&
      value !== null &&
      ['__proto__', 'constructor', 'prototype'].some((key) =>
        Object.hasOwn(value, key),
      )
    ) {
      throw new BadRequestException([
        'Request contains unsupported properties',
      ]);
    }

    return super.transform(value, metadata);
  }
}

export function createRequestValidationPipe(): ValidationPipe {
  return new RequestValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => {
      const messages = errors.flatMap((error) => {
        if (error.constraints?.whitelistValidation) {
          return ['Request contains unsupported properties'];
        }

        return Object.values(
          error.constraints ?? { invalid: 'Invalid request body' },
        );
      });

      return new BadRequestException([...new Set(messages)]);
    },
  });
}
