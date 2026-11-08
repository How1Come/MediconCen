import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Environment } from '../config/environment';
import { createDatabaseOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        ...createDatabaseOptions(config),
        retryAttempts: 3,
        retryDelay: 1000,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
