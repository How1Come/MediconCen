import { ConfigService } from '@nestjs/config';
import type { DataSourceOptions } from 'typeorm';
import type { Environment } from '../config/environment';
import { IdentityMapping } from '../identity/identity.entity';
import { CreateIdentityMappings1794096000000 } from './migrations/1794096000000-create-identity-mappings';

export function createDatabaseOptions(
  config: ConfigService<Environment, true>,
): DataSourceOptions {
  return {
    type: 'mysql',
    host: config.get('MYSQL_HOST', { infer: true }),
    port: config.get('MYSQL_PORT', { infer: true }),
    database: config.get('MYSQL_DATABASE', { infer: true }),
    username: config.get('MYSQL_USER', { infer: true }),
    password: config.get('MYSQL_PASSWORD', { infer: true }),
    charset: 'utf8mb4',
    timezone: 'Z',
    poolSize: 10,
    connectTimeout: 5000,
    entities: [IdentityMapping],
    migrations: [CreateIdentityMappings1794096000000],
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'none',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    invalidWhereValuesBehavior: { null: 'throw', undefined: 'throw' },
  };
}
