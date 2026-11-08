import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ResolveIdentityDto } from '../identity/dto/resolve-identity.dto';
import { ResolvedIdentityDto } from '../identity/dto/resolved-identity.dto';

export function createApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('MediconCen identity API')
    .setDescription(
      'Resolves an ordered pair of identifiers to a persistent UUID v4. MySQL stores the mapping; optional Redis caching falls back to MySQL. Both new and existing pairs return HTTP 200. This evaluation API has no authentication.',
    )
    .setVersion('0.1.0')
    .addTag('Identity', 'Resolve and reuse persistent identity mappings.')
    .build();
  const document = SwaggerModule.createDocument(app, configuration);

  for (const model of [ResolveIdentityDto, ResolvedIdentityDto, ApiErrorDto]) {
    const schema = document.components?.schemas?.[model.name];

    if (schema && !('$ref' in schema)) {
      schema.additionalProperties = false;
    }
  }

  return document;
}

export function setupDocumentation(app: INestApplication): void {
  SwaggerModule.setup('docs', app, () => createApiDocument(app), {
    customSiteTitle: 'MediconCen API documentation',
    jsonDocumentUrl: 'docs-json',
    yamlDocumentUrl: 'docs-yaml',
    swaggerOptions: { validatorUrl: null },
  });
}
