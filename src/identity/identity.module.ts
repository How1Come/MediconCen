import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityMapping } from './identity.entity';
import { IdentityRepository } from './identity.repository';

@Module({
  imports: [TypeOrmModule.forFeature([IdentityMapping])],
  providers: [IdentityRepository],
  exports: [IdentityRepository],
})
export class IdentityModule {}
