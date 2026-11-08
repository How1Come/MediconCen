import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { createRequestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import { ResolveIdentityDto } from '../../src/identity/dto/resolve-identity.dto';

describe('Identity request validation', () => {
  let pipe: ValidationPipe;
  const metadata: ArgumentMetadata = {
    type: 'body',
    metatype: ResolveIdentityDto,
  };

  beforeEach(() => {
    pipe = createRequestValidationPipe();
  });

  async function errorResponse(body: unknown): Promise<string | object> {
    try {
      await pipe.transform(body, metadata);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        return error.getResponse();
      }

      throw error;
    }

    throw new Error('Expected request validation to fail');
  }

  it('preserves case, Unicode and surrounding whitespace in valid IDs', async () => {
    const body = { id1: '  AbC 😀  ', id2: '\té\u0301 \n' };
    const result: unknown = await pipe.transform(body, metadata);

    expect(result).toBeInstanceOf(ResolveIdentityDto);
    expect(result).toEqual(body);
  });

  it.each<[string, unknown]>([
    ['a missing body', undefined],
    ['a null body', null],
    ['an array body', []],
    ['a string body', 'ABC123'],
    ['both IDs missing', {}],
    ['id1 missing', { id2: 'XYZ456' }],
    ['id2 missing', { id1: 'ABC123' }],
    ['a numeric ID', { id1: 123, id2: 'XYZ456' }],
    ['a boolean ID', { id1: 'ABC123', id2: true }],
    ['an object ID', { id1: {}, id2: 'XYZ456' }],
    ['an array ID', { id1: 'ABC123', id2: ['XYZ456'] }],
    ['an empty ID', { id1: '', id2: 'XYZ456' }],
    ['a whitespace-only ID', { id1: 'ABC123', id2: '\n \t' }],
  ])('rejects %s without coercion', async (_, body) => {
    await expect(pipe.transform(body, metadata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['id1', 'id2'] as const)(
    'accepts 255 astral code points in %s and rejects 256',
    async (field) => {
      const body = { id1: 'ABC123', id2: 'XYZ456' };

      await expect(
        pipe.transform({ ...body, [field]: '😀'.repeat(255) }, metadata),
      ).resolves.toEqual({ ...body, [field]: '😀'.repeat(255) });
      await expect(
        pipe.transform({ ...body, [field]: '😀'.repeat(256) }, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('counts variation selectors as code points instead of ignoring them', async () => {
    const accepted = 'a\uFE0F'.repeat(127) + 'a';
    const rejected = 'a\uFE0F'.repeat(128);

    await expect(
      pipe.transform({ id1: accepted, id2: 'XYZ456' }, metadata),
    ).resolves.toEqual({ id1: accepted, id2: 'XYZ456' });
    await expect(
      pipe.transform({ id1: rejected, id2: 'XYZ456' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('includes trailing newlines in the 255-code-point limit', async () => {
    await expect(
      pipe.transform({ id1: 'a'.repeat(255) + '\n', id2: 'XYZ456' }, metadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['\uD800', '\uDC00', 'prefix\uD800\n'])(
    'rejects malformed UTF-16 IDs',
    async (id1) => {
      await expect(
        pipe.transform({ id1, id2: 'XYZ456' }, metadata),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('returns a static message for unknown fields without echoing names or values', async () => {
    const name = randomUUID();
    const value = randomUUID();
    const response = await errorResponse({
      id1: 'ABC123',
      id2: 'XYZ456',
      [name]: value,
    });

    expect(response).toMatchObject({
      statusCode: 400,
      message: ['Request contains unsupported properties'],
    });
    expect(JSON.stringify(response)).not.toContain(name);
    expect(JSON.stringify(response)).not.toContain(value);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects an own %s field before class transformation',
    async (name) => {
      const value = randomUUID();
      const response = await errorResponse({
        id1: 'ABC123',
        id2: 'XYZ456',
        [name]: value,
      });

      expect(response).toMatchObject({
        statusCode: 400,
        message: ['Request contains unsupported properties'],
      });
      expect(JSON.stringify(response)).not.toContain(name);
      expect(JSON.stringify(response)).not.toContain(value);
    },
  );
});
