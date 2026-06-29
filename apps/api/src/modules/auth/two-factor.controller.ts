import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { SkipAudit } from '../audit/skip-audit.decorator';
import type { AuthenticatedUser } from './rbac/authenticated-user';
import { TwoFactorCodeDto } from './dto/auth.dto';
import { TwoFactorService } from './two-factor.service';

/**
 * Authenticated management of the current user's own two-factor auth. (The pre-token login challenge
 * is completed on the public `/auth/2fa/verify`.) `@SkipAudit` keeps TOTP codes out of the audit body.
 */
@Controller('auth/2fa')
@SkipAudit()
export class TwoFactorController {
  constructor(private readonly twofa: TwoFactorService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.twofa.status(user.userId, user.tenantId);
  }

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(@CurrentUser() user: AuthenticatedUser) {
    return this.twofa.setup(user.userId, user.tenantId);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  enable(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.twofa.enable(user.userId, user.tenantId, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disable(@Body() dto: TwoFactorCodeDto, @CurrentUser() user: AuthenticatedUser) {
    await this.twofa.disable(user.userId, user.tenantId, dto.code);
    return { enabled: false };
  }
}
