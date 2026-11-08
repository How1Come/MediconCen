import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Environment } from './config/environment';
import { setupDocumentation } from './documentation/swagger';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { abortOnError: false });

  try {
    const config = app.get<ConfigService<Environment, true>>(ConfigService);

    app.enableShutdownHooks();
    setupDocumentation(app);
    await app.listen(config.get('PORT', { infer: true }));
  } catch (error: unknown) {
    try {
      await app.close();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Application startup and cleanup failed',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    Logger.error(
      error instanceof Error ? error.message : 'Application failed to start',
      'Bootstrap',
    );
    process.exit(1);
  });
}
