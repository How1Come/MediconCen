import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ResolveIdentityDto } from './dto/resolve-identity.dto';
import { IdentityService } from './identity.service';

@Controller('users')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Body() dto: ResolveIdentityDto): Promise<{ userID: string }> {
    return this.identityService.resolve(dto.id1, dto.id2);
  }
}
