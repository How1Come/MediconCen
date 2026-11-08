import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { config as loadEnvironmentFile } from 'dotenv';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment';
import type { Environment } from '../config/environment';
import { createDatabaseOptions } from './database.options';

loadEnvironmentFile({ quiet: true });

const environment = validateEnvironment(process.env);
const config = new ConfigService<Environment, true>(environment);

export default new DataSource(createDatabaseOptions(config));
