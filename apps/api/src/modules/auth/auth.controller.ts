import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard, AuthenticatedRequest } from './guards/auth.guard';
import {
  DevPasswordLoginDto,
  RegisterDto,
  RevokeSessionDto,
  SendOtpDto,
  VerifyOtpDto,
} from './dto/auth.dto';

@ApiTags('authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start patient or pending-doctor registration by mobile OTP' })
  register(@Body() dto: RegisterDto, @Req() request: AuthenticatedRequest) {
    return this.auth.register(dto, request);
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an OTP for login or account recovery' })
  sendOtp(@Body() dto: SendOtpDto, @Req() request: AuthenticatedRequest) {
    return this.auth.sendOtp(dto, request);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a one-time code and establish a session' })
  async verify(
    @Body() dto: VerifyOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verify(dto, request);
    return this.presentSession(result, dto.platform ?? 'WEB', response);
  }

  @Post('dev-password-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in to the configured local patient test account (development only)',
  })
  async devPasswordLogin(
    @Body() dto: DevPasswordLoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.devPasswordLogin(dto, request);
    return this.presentSession(result, 'WEB', response);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieToken = readCookie(request, 'hv_refresh');
    const token = cookieToken;
    if (!token) throw new UnauthorizedException('Session expired. Please sign in again.');
    let result: Awaited<ReturnType<AuthService['refresh']>>;
    try {
      result = await this.auth.refresh(token, request);
    } catch (error) {
      if (cookieToken) this.clearCookies(response);
      throw error;
    }
    return this.presentSession(result, 'WEB', response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiCookieAuth('hv_access')
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(request.auth!.sessionId, request.auth!.userId, request);
    this.clearCookies(response);
    return { success: true };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiCookieAuth('hv_access')
  @ApiOperation({ summary: 'Revoke every active session for the current user' })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logoutAll(request.auth!.userId, request);
    this.clearCookies(response);
    return result;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('hv_access')
  @ApiOperation({ summary: 'Return the authenticated account' })
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.me(request.auth!.userId);
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('hv_access')
  @ApiOperation({ summary: 'List active sessions for the authenticated account' })
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.auth!.userId, request.auth!.sessionId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('hv_access')
  @ApiOperation({ summary: 'Revoke one of the authenticated account’s sessions' })
  deleteSession(@Param() dto: RevokeSessionDto, @Req() request: AuthenticatedRequest) {
    return this.auth.revokeSession(dto.sessionId, request.auth!.userId, request);
  }

  private presentSession(
    result:
      Awaited<ReturnType<AuthService['verify']>> | Awaited<ReturnType<AuthService['refresh']>>,
    platform: string,
    response: Response,
  ) {
    if (platform === 'WEB') {
      this.setCookies(response, result.accessToken, result.refreshToken);
      return { user: result.user, accessTokenExpiresIn: result.accessTokenExpiresIn };
    }
    return result;
  }

  private setCookies(response: Response, accessToken: string, refreshToken: string) {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('AUTH_COOKIE_SAME_SITE', 'lax');
    const secure = this.config.get<string>('NODE_ENV') === 'production' || sameSite === 'none';
    const common = { httpOnly: true, secure, sameSite, path: '/api' as const };
    const legacy = { httpOnly: true, secure, sameSite, path: '/api/auth' as const };
    response.clearCookie('hv_access', legacy);
    response.clearCookie('hv_refresh', legacy);
    response.cookie('hv_access', accessToken, { ...common, maxAge: 15 * 60 * 1000 });
    response.cookie('hv_refresh', refreshToken, { ...common, maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  private clearCookies(response: Response) {
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('AUTH_COOKIE_SAME_SITE', 'lax');
    const secure = this.config.get<string>('NODE_ENV') === 'production' || sameSite === 'none';
    const options = { httpOnly: true, secure, sameSite, path: '/api' as const };
    response.clearCookie('hv_access', options);
    response.clearCookie('hv_refresh', options);
    const legacy = { httpOnly: true, secure, sameSite, path: '/api/auth' as const };
    response.clearCookie('hv_access', legacy);
    response.clearCookie('hv_refresh', legacy);
  }
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index >= 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
