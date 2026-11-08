import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '../cache/cache.module';
import { IdentityController } from './identity.controller';
import { IdentityMapping } from './identity.entity';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';

@Module({
  imports: [CacheModule, TypeOrmModule.forFeature([IdentityMapping])],
  controllers: [IdentityController],
  providers: [IdentityRepository, IdentityService],
  exports: [IdentityRepository],
})
export class IdentityModule {}
