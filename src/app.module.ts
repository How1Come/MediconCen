import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
})
export class AppModule {}
