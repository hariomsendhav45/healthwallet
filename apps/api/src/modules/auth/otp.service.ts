import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserRole } from '../../generated/prisma';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from './token.service';
import { SMS_PROVIDER, SmsProvider } from './sms/sms-provider';
import { SecurityRateLimiter } from './security-rate-limiter.service';
import { TooManyRequestsException } from './too-many-requests.exception';

@Injectable()
export class OtpService {
  private readonly lifetimeMs = 5 * 60 * 1000;
  private readonly maxAttempts: number;
  private readonly maxRequestsPerHour: number;
  private readonly resendCooldownSeconds: number;
  private readonly maxRequestsPerIp: number;
  private readonly maxVerificationsPerIp: number;

  private readInteger(key: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
    }
    return value;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService,
    private readonly limiter: SecurityRateLimiter,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {
    this.maxAttempts = this.readInteger('OTP_MAX_ATTEMPTS', 5, 1, 10);
    this.maxRequestsPerHour = this.readInteger('OTP_MAX_REQUESTS_PER_HOUR', 5, 1, 20);
    this.resendCooldownSeconds = this.readInteger('OTP_RESEND_COOLDOWN_SECONDS', 45, 30, 60);
    this.maxRequestsPerIp = this.readInteger('OTP_MAX_REQUESTS_PER_IP_PER_15_MINUTES', 20, 1, 100);
    this.maxVerificationsPerIp = this.readInteger(
      'OTP_MAX_VERIFICATIONS_PER_IP_PER_15_MINUTES',
      30,
      1,
      100,
    );
  }

  async start(input: {
    phoneNumber: string;
    purpose: OtpPurpose;
    role?: UserRole;
    ipAddress?: string;
    deviceInformation?: string;
    deliver: boolean;
  }) {
    const phoneKey = input.phoneNumber;
    const ipKey = input.ipAddress || 'unknown';
    this.limiter.consume(`otp:ip:${ipKey}`, this.maxRequestsPerIp, 15 * 60 * 1000);
    this.limiter.consume(`otp:phone:${phoneKey}`, this.maxRequestsPerHour, 60 * 60 * 1000);

    const now = new Date();
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const challengeId = randomUUID();
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${phoneKey}))`;
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const [recentCount, lastChallenge] = await Promise.all([
        tx.otpChallenge.count({ where: { phoneNumber: phoneKey, createdAt: { gte: hourAgo } } }),
        tx.otpChallenge.findFirst({
          where: {
            phoneNumber: phoneKey,
            createdAt: { gte: new Date(now.getTime() - this.resendCooldownSeconds * 1000) },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      if (recentCount >= this.maxRequestsPerHour) {
        throw new TooManyRequestsException('Too many authentication requests. Try again later.');
      }
      if (lastChallenge) {
        const remaining =
          this.resendCooldownSeconds -
          Math.floor((now.getTime() - lastChallenge.createdAt.getTime()) / 1000);
        if (remaining > 0) {
          throw new TooManyRequestsException(
            `Please wait ${remaining} seconds before requesting another code.`,
          );
        }
      }
      await tx.otpChallenge.updateMany({
        where: { phoneNumber: phoneKey, consumedAt: null },
        data: { consumedAt: now },
      });
      return tx.otpChallenge.create({
        data: {
          id: challengeId,
          phoneNumber: phoneKey,
          otpHash: this.tokens.hashOtp(challengeId, code),
          purpose: input.purpose,
          ...(input.role ? { requestedRole: input.role } : {}),
          expiresAt,
          maxAttempts: this.maxAttempts,
        },
      });
    });
    if (input.deliver) {
      try {
        await this.sms.sendOtp(phoneKey, code);
      } catch {
        await this.prisma.otpChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
        await this.prisma.authAuditLog.create({
          data: {
            eventType: 'OTP_DELIVERY_FAILED',
            ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
            ...(input.deviceInformation ? { deviceInformation: input.deviceInformation } : {}),
          },
        });
        // Keep the same public response for eligible and unknown numbers to avoid account enumeration.
      }
    }
    await this.prisma.authAuditLog.create({
      data: {
        eventType: 'OTP_REQUESTED',
        ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
        ...(input.deviceInformation ? { deviceInformation: input.deviceInformation } : {}),
      },
    });
    return {
      challengeId: challenge.id,
      expiresInSeconds: this.lifetimeMs / 1000,
      resendAfterSeconds: this.resendCooldownSeconds,
    };
  }

  async recordFailedAttempt(
    challengeId: string,
    ipAddress: string | undefined,
    deviceInformation: string | undefined,
    maxAttempts: number,
  ) {
    await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    await this.prisma.authAuditLog.create({
      data: {
        eventType: 'OTP_VERIFICATION_FAILED',
        ...(ipAddress ? { ipAddress } : {}),
        ...(deviceInformation ? { deviceInformation } : {}),
      },
    });
  }

  hashMatches(challengeId: string, code: string, storedHash: string): boolean {
    return this.tokens.safeEqualHex(this.tokens.hashOtp(challengeId, code), storedHash);
  }

  checkVerificationRateLimit(ipAddress?: string): void {
    this.limiter.consume(
      `verify:ip:${ipAddress || 'unknown'}`,
      this.maxVerificationsPerIp,
      15 * 60 * 1000,
    );
  }
}
