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
      value !== null
    ) {
      if (
        Object.getOwnPropertyNames(value).some(
          (key) => key === 'prototype' || Object.hasOwn(Object.prototype, key),
        )
      ) {
        throw new BadRequestException([
          'Request contains unsupported properties',
        ]);
      }

      if (
        Object.values(value).some(
          (field: unknown) => field !== null && typeof field === 'object',
        )
      ) {
        throw new BadRequestException(['Request properties must be strings']);
      }
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
