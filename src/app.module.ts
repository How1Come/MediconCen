import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { createRequestValidationPipe } from './common/pipes/request-validation.pipe';
import { validateEnvironment } from './config/environment';
import { DatabaseModule } from './database/database.module';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    DatabaseModule,
    IdentityModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createRequestValidationPipe },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
