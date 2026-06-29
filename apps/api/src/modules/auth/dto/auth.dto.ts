import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(16)
  refreshToken!: string;
}

/** Complete a 2FA login: the challenge ticket from /auth/login + a 6-digit TOTP or recovery code. */
export class TwoFactorVerifyDto {
  @IsString() @MinLength(10) ticket!: string;
  @IsString() @MinLength(6) code!: string;
}

/** A single 2FA code (TOTP or recovery), for enable/disable. */
export class TwoFactorCodeDto {
  @IsString() @MinLength(6) code!: string;
}
