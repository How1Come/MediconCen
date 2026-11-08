import { Module } from '@nestjs/common';
import { IdentityCache } from './identity-cache.service';

@Module({
  providers: [IdentityCache],
  exports: [IdentityCache],
})
export class CacheModule {}
