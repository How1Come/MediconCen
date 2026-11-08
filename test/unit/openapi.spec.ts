import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';
import { createRequestValidationPipe } from '../../src/common/pipes/request-validation.pipe';
import {
  createApiDocument,
  setupDocumentation,
} from '../../src/documentation/swagger';
import { IdentityController } from '../../src/identity/identity.controller';
import { IdentityService } from '../../src/identity/identity.service';

describe('Published OpenAPI contract', () => {
  let app: INestApplication<Server>;
  let document: OpenAPIObject;
  const service: jest.Mocked<Pick<IdentityService, 'resolve'>> = {
    resolve: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [{ provide: IdentityService, useValue: service }],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false,
    });
    app.useGlobalPipes(createRequestValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter(app.get(HttpAdapterHost)));
    setupDocumentation(app);
    await app.init();
    document = createApiDocument(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  function model(name: string) {
    const schema = document.components?.schemas?.[name];

    if (!schema || '$ref' in schema) {
      throw new Error(`Expected the ${name} object schema`);
    }

    return schema;
  }

  function example(status: string, name?: string): unknown {
    const response = document.paths['/users/resolve']?.post?.responses[status];

    if (!response || '$ref' in response) {
      throw new Error(`Expected an HTTP ${status} response definition`);
    }

    const content = response.content?.['application/json'];

    if (!name) {
      return content?.example;
    }

    const value = content?.examples?.[name];

    if (!value || '$ref' in value) {
      throw new Error(`Expected the ${name} response example`);
    }

    return value.value as unknown;
  }

  it('serves the generated JSON contract with the implemented HTTP statuses', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(document);
    expect(document.openapi).toBe('3.0.0');
    const operation = document.paths['/users/resolve']?.post;
    expect(operation?.operationId).toBe('resolveIdentity');
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '413',
      '415',
      '500',
      '503',
    ]);
  });

  it('serves Swagger UI and its local initialization asset', async () => {
    const page = await request(app.getHttpServer()).get('/docs/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>MediconCen API documentation</title>');
    const script = await request(app.getHttpServer()).get(
      '/docs/swagger-ui-init.js',
    );
    expect(script.status).toBe(200);
    expect(script.text).toContain('SwaggerUIBundle');
    expect(script.text).toContain('resolveIdentity');
  });

  it('serves a YAML version of the same API definition', async () => {
    const response = await request(app.getHttpServer()).get('/docs-yaml');
    expect(response.status).toBe(200);
    expect(response.text).toContain('openapi: 3.0.0');
    expect(response.text).toContain('/users/resolve:');
    expect(response.text).toContain('operationId: resolveIdentity');
  });

  it('documents required strings, Unicode length, nonblank values, and rejected extras', () => {
    const schema = model('ResolveIdentityDto');
    expect(schema.required).toEqual(['id1', 'id2']);
    expect(schema.additionalProperties).toBe(false);

    for (const name of ['id1', 'id2']) {
      expect(schema.properties?.[name]).toMatchObject({
        type: 'string',
        minLength: 1,
        maxLength: 255,
        pattern: '\\S',
      });
    }

    expect(schema.description).toContain('valid Unicode');
    expect(schema.description).toContain('normalization are preserved');
  });

  it('accepts the documented request example and returns the documented UUID shape', async () => {
    const input = model('ResolveIdentityDto');
    const output = model('ResolvedIdentityDto');
    const identifier = output.properties?.userID;

    if (!identifier || '$ref' in identifier) {
      throw new Error('Expected a userID string schema');
    }

    const userID: unknown = identifier.example;
    service.resolve.mockResolvedValueOnce({ userID: String(userID) });
    const body = Object.fromEntries(
      Object.entries(input.properties ?? {}).map(([key, property]) => [
        key,
        '$ref' in property ? undefined : (property.example as unknown),
      ]),
    );
    const response = await request(app.getHttpServer())
      .post('/users/resolve')
      .send(body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userID });
    expect(service.resolve).toHaveBeenCalledWith(body.id1, body.id2);
    expect(output.required).toEqual(['userID']);
    expect(output.additionalProperties).toBe(false);
    expect(identifier.format).toBe('uuid');
    expect(userID).toEqual(expect.stringMatching(identifier.pattern ?? '^$'));
  });

  it('matches both documented validation and malformed-JSON examples', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/users/resolve')
      .send({ id1: ' ', id2: 'valid' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(example('400', 'validation'));
    const malformed = await request(app.getHttpServer())
      .post('/users/resolve')
      .set('Content-Type', 'application/json')
      .send('{"id1":');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual(example('400', 'malformedJson'));
    const message = model('ApiErrorDto').properties?.message;
    expect(message).toEqual(
      expect.objectContaining({
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      }),
    );
    expect(message).not.toHaveProperty('type');
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it('matches the documented payload-too-large example', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/resolve')
      .send({ id1: 'x'.repeat(110000), id2: 'valid' });
    expect(response.status).toBe(413);
    expect(response.body).toEqual(example('413'));
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it('matches the documented unsupported-charset example', async () => {
    const response = await request(app.getHttpServer())
      .post('/users/resolve')
      .set('Content-Type', 'application/json; charset=unsupported')
      .send('{"id1":"valid","id2":"valid"}');
    expect(response.status).toBe(415);
    expect(response.body).toEqual(example('415'));
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it.each([
    [
      503,
      Object.assign(new Error('sensitive-test-marker'), {
        code: 'ECONNREFUSED',
      }),
    ],
    [500, new Error('sensitive-test-marker')],
  ])(
    'matches the documented HTTP %s error without internal details',
    async (status, error) => {
      service.resolve.mockRejectedValueOnce(error);
      const response = await request(app.getHttpServer())
        .post('/users/resolve')
        .send({ id1: 'valid', id2: 'valid' });
      expect(response.status).toBe(status);
      expect(response.body).toEqual(example(String(status)));
      expect(response.text).not.toContain('sensitive-test-marker');
    },
  );
});
