import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from './decorators/public.decorator';
import { LoginDto, RefreshDto } from './dto/auth.dto';
import { AuthService } from './auth.service';

/** Authentication endpoints — all on the public allowlist (no bearer token required). */
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}
