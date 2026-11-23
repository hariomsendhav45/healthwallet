import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AccountStatus, OtpPurpose, User, UserRole } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { OtpService } from './otp.service';
import { SessionService } from './session.service';
import { AuthenticatedRequest } from './guards/auth.guard';
import { DevPasswordLoginDto, RegisterDto, SendOtpDto, VerifyOtpDto } from './dto/auth.dto';
import { SecurityRateLimiter } from './security-rate-limiter.service';

const GENERIC_OTP_MESSAGE = 'If eligible, a verification code will be sent when SMS delivery is available.';
const INVALID_OTP_MESSAGE =
  'The verification code is invalid or expired. Request a new code and try again.';

function normalizeIndiaPhone(countryCode: string, mobileNumber: string): string {
  const digits = mobileNumber.replace(/[\s()-]/g, '');
  if (countryCode !== '+91' || !/^[6-9]\d{9}$/.test(digits)) {
    throw new BadRequestException('Enter a valid Indian mobile number.');
  }
  return `${countryCode}${digits}`;
}

function deviceInfo(request: AuthenticatedRequest, supplied?: string): string | undefined {
  const agent = request.headers['user-agent'];
  const value = supplied ?? (Array.isArray(agent) ? agent[0] : agent);
  return value?.slice(0, 256) || undefined;
}

function publicUser(user: User) {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    phoneVerified: user.phoneVerified,
    role: user.role,
    accountStatus: user.accountStatus,
    doctorVerificationStatus: user.doctorVerificationStatus,
  };
}

function constantTimeStringEqual(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(left).digest(),
    createHash('sha256').update(right).digest(),
  );
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = 'code' in error ? String(error.code) : '';
  return (
    error.name === 'PrismaClientInitializationError' ||
    ['P1001', 'P2021', 'P2022'].includes(code) ||
    error.message.includes("Can't reach database server")
  );
}

function databaseUnavailableException(): ServiceUnavailableException {
  return new ServiceUnavailableException(
    'The local database is unavailable or its migrations are pending. Start PostgreSQL and run npm run prisma:migrate:dev.',
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    private readonly rateLimiter: SecurityRateLimiter,
  ) {}

  private devPasswordModeEnabled(): boolean {
    const environment = this.config.get<string>('NODE_ENV');
    return (
      (environment === 'development' || environment === 'test') &&
      this.config.get<string>('DEV_PASSWORD_AUTH_ENABLED') === 'true'
    );
  }

  private assertOtpEnabled(): void {
    if (this.devPasswordModeEnabled()) {
      throw new ConflictException('OTP sign-in is paused in local password testing mode.');
    }
  }

  async register(dto: RegisterDto, request: AuthenticatedRequest) {
    this.assertOtpEnabled();
    const phoneNumber = normalizeIndiaPhone(dto.countryCode, dto.mobileNumber);
    const existing = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });
    const challenge = await this.otp.start({
      phoneNumber,
      purpose: OtpPurpose.REGISTER,
      role: (dto.role ?? 'PATIENT') as UserRole,
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(deviceInfo(request) ? { deviceInformation: deviceInfo(request)! } : {}),
      deliver: !existing,
    });
    return { ...challenge, message: GENERIC_OTP_MESSAGE };
  }

  async sendOtp(dto: SendOtpDto, request: AuthenticatedRequest) {
    this.assertOtpEnabled();
    const phoneNumber = normalizeIndiaPhone(dto.countryCode, dto.mobileNumber);
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { phoneVerified: true, accountStatus: true },
    });
    const eligible = Boolean(user?.phoneVerified && user.accountStatus === AccountStatus.ACTIVE);
    const challenge = await this.otp.start({
      phoneNumber,
      purpose: dto.purpose as OtpPurpose,
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(deviceInfo(request) ? { deviceInformation: deviceInfo(request)! } : {}),
      deliver: eligible,
    });
    return { ...challenge, message: GENERIC_OTP_MESSAGE };
  }

  async verify(dto: VerifyOtpDto, request: AuthenticatedRequest) {
    this.assertOtpEnabled();
    this.otp.checkVerificationRateLimit(request.ip);
    const challenge = await this.prisma.otpChallenge.findUnique({ where: { id: dto.challengeId } });
    const now = new Date();
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.attempts >= challenge.maxAttempts
    ) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }
    const info = deviceInfo(request, dto.deviceName);
    if (!this.otp.hashMatches(challenge.id, dto.code, challenge.otpHash)) {
      await this.otp.recordFailedAttempt(challenge.id, request.ip, info, challenge.maxAttempts);
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const runTransaction = () =>
      this.prisma.$transaction(async (tx) => {
        const consumed = await tx.otpChallenge.updateMany({
          where: {
            id: challenge.id,
            consumedAt: null,
            expiresAt: { gt: now },
            attempts: { lt: challenge.maxAttempts },
          },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) return { failure: 'used' as const };

        let user = await tx.user.findUnique({ where: { phoneNumber: challenge.phoneNumber } });
        if (challenge.purpose === OtpPurpose.REGISTER) {
          if (user) return { failure: 'already-registered' as const };
          const role = challenge.requestedRole ?? UserRole.PATIENT;
          user = await tx.user.create({
            data: {
              phoneNumber: challenge.phoneNumber,
              phoneVerified: true,
              role,
              doctorVerificationStatus: role === UserRole.DOCTOR ? 'PENDING' : null,
            },
          });
        } else if (!user || !user.phoneVerified || user.accountStatus !== AccountStatus.ACTIVE) {
          return { failure: 'unavailable' as const };
        }

        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: now },
        });
        const platform = dto.platform ?? 'WEB';
        const tokenPair = await this.sessions.createInTransaction(tx, updatedUser, {
          platform,
          ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
          ...(dto.deviceName ? { deviceName: dto.deviceName } : {}),
        });
        await tx.authAuditLog.create({
          data: {
            userId: updatedUser.id,
            eventType:
              challenge.purpose === OtpPurpose.REGISTER
                ? 'REGISTRATION_SUCCEEDED'
                : 'LOGIN_SUCCEEDED',
            ...(request.ip ? { ipAddress: request.ip } : {}),
            ...(info ? { deviceInformation: info } : {}),
          },
        });
        return { user: updatedUser, ...tokenPair };
      });
    let outcome: Awaited<ReturnType<typeof runTransaction>>;
    try {
      outcome = await runTransaction();
    } catch (error) {
      if (isDatabaseUnavailable(error)) throw databaseUnavailableException();
      throw error;
    }
    if ('failure' in outcome) {
      await this.prisma.authAuditLog.create({
        data: {
          eventType:
            challenge.purpose === OtpPurpose.REGISTER ? 'REGISTRATION_FAILED' : 'LOGIN_FAILED',
          ...(request.ip ? { ipAddress: request.ip } : {}),
          ...(info ? { deviceInformation: info } : {}),
        },
      });
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }
    return { ...outcome, user: publicUser(outcome.user), accessTokenExpiresIn: 15 * 60 };
  }

  async devPasswordLogin(dto: DevPasswordLoginDto, request: AuthenticatedRequest) {
    if (!this.devPasswordModeEnabled()) throw new NotFoundException();
    const configuredPassword = this.config.get<string>('DEV_TEST_PASSWORD') ?? '';
    if (Buffer.byteLength(configuredPassword) < 16) {
      throw new ServiceUnavailableException(
        'Set a development test password of at least 16 characters before signing in.',
      );
    }
    const phoneNumber = normalizeIndiaPhone(dto.countryCode, dto.mobileNumber);
    const configuredPhone = this.config.get<string>('DEV_TEST_PHONE', '+919999999999');
    if (!/^\+91[6-9]\d{9}$/.test(configuredPhone)) {
      throw new ServiceUnavailableException(
        'Set a valid synthetic DEV_TEST_PHONE before signing in.',
      );
    }
    const patientTestLogin =
      constantTimeStringEqual(phoneNumber, configuredPhone) &&
      constantTimeStringEqual(dto.password, configuredPassword);
    const ip = request.ip ?? 'unknown';
    this.rateLimiter.consume(`dev-password:ip:${ip}`, 10, 15 * 60 * 1000);
    this.rateLimiter.consume(`dev-password:phone:${phoneNumber}`, 5, 15 * 60 * 1000);

    if (!patientTestLogin) {
      await this.recordDevPasswordFailure(ip);
      throw new UnauthorizedException('The test mobile number or password is incorrect.');
    }

    const runTransaction = () =>
      this.prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { phoneNumber } });
        if (user && !user.isDevelopmentTestAccount) return { failure: 'reserved' as const };
        if (!user) {
          user = await tx.user.create({
            data: {
              phoneNumber,
              phoneVerified: true,
              role: UserRole.PATIENT,
              isDevelopmentTestAccount: true,
            },
          });
        }
        if (user.role !== UserRole.PATIENT) return { failure: 'unavailable' as const };
        if (!user || user.accountStatus !== AccountStatus.ACTIVE)
          return { failure: 'unavailable' as const };
        const updatedUser = await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        const tokenPair = await this.sessions.createInTransaction(tx, updatedUser, {
          platform: 'WEB',
        });
        await tx.authAuditLog.create({
          data: {
            userId: updatedUser.id,
            eventType: 'DEV_TEST_LOGIN_SUCCEEDED',
            ...(ip !== 'unknown' ? { ipAddress: ip.slice(0, 64) } : {}),
            ...(deviceInfo(request) ? { deviceInformation: deviceInfo(request)! } : {}),
          },
        });
        return { user: updatedUser, ...tokenPair };
      });
    let outcome: Awaited<ReturnType<typeof runTransaction>>;
    try {
      outcome = await runTransaction();
    } catch (error) {
      if (isDatabaseUnavailable(error)) throw databaseUnavailableException();
      throw error;
    }

    if ('failure' in outcome) {
      await this.recordDevPasswordFailure(ip);
      throw new UnauthorizedException('The test mobile number or password is incorrect.');
    }
    return { ...outcome, user: publicUser(outcome.user), accessTokenExpiresIn: 15 * 60 };
  }

  private async recordDevPasswordFailure(ipAddress: string) {
    try {
      await this.prisma.authAuditLog.create({
        data: {
          eventType: 'DEV_TEST_LOGIN_FAILED',
          ...(ipAddress !== 'unknown' ? { ipAddress: ipAddress.slice(0, 64) } : {}),
        },
      });
    } catch (error) {
      if (isDatabaseUnavailable(error)) throw databaseUnavailableException();
      throw error;
    }
  }

  async refresh(refreshToken: string, request: AuthenticatedRequest) {
    const result = await this.sessions.rotate(refreshToken, request.ip, deviceInfo(request));
    return { ...result, user: publicUser(result.user), accessTokenExpiresIn: 15 * 60 };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.accountStatus !== 'ACTIVE')
      throw new UnauthorizedException('Authentication required.');
    return { user: publicUser(user) };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.refreshSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        deviceName: true,
        platform: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
    return {
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
      })),
    };
  }

  async logoutAll(userId: string, request: AuthenticatedRequest) {
    const now = new Date();
    const revoked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: 'ALL_SESSIONS_REVOKED',
          ...(request.ip ? { ipAddress: request.ip } : {}),
        },
      });
      return result;
    });
    return { revokedCount: revoked.count };
  }

  async revokeSession(sessionId: string, userId: string, request: AuthenticatedRequest) {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) return { revoked: false };
    await this.sessions.revoke(sessionId, userId, request.ip, deviceInfo(request));
    return { revoked: true };
  }
}
