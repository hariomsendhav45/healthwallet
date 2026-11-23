import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, User } from '../../generated/prisma';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from './token.service';

export type DeviceMetadata = { platform?: string; deviceId?: string; deviceName?: string };

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async createInTransaction(tx: Prisma.TransactionClient, user: User, device: DeviceMetadata) {
    const now = new Date();
    const sessionId = randomUUID();
    const refreshToken = this.tokens.createRefreshToken(sessionId);
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      sid: sessionId,
      role: user.role,
    });
    await tx.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.tokens.hashRefreshToken(refreshToken),
        expiresAt: new Date(now.getTime() + this.tokens.refreshTokenSeconds * 1000),
        lastUsedAt: now,
        ...(device.platform ? { platform: device.platform } : {}),
        ...(device.deviceId ? { deviceId: device.deviceId } : {}),
        ...(device.deviceName ? { deviceName: device.deviceName } : {}),
      },
    });
    return { sessionId, accessToken, refreshToken };
  }

  async rotate(refreshToken: string, ipAddress?: string, deviceInformation?: string) {
    const sessionId = refreshToken.split('.')[0];
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId))
      throw new UnauthorizedException('Session expired. Please sign in again.');
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.refreshSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (!session) return { failure: 'missing' as const };
      const presentedHash = this.tokens.hashRefreshToken(refreshToken);
      const matches = this.tokens.safeEqualHex(session.tokenHash, presentedHash);
      if (!matches) {
        if (!session.revokedAt) {
          await tx.refreshSession.updateMany({
            where: { id: session.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.authAuditLog.create({
            data: {
              userId: session.userId,
              eventType: 'SESSION_REUSE_DETECTED',
              ...(ipAddress ? { ipAddress } : {}),
              ...(deviceInformation ? { deviceInformation } : {}),
            },
          });
        }
        return { failure: 'reuse' as const };
      }
      const now = new Date();
      if (
        session.revokedAt ||
        session.expiresAt <= now ||
        session.user.accountStatus !== 'ACTIVE'
      ) {
        if (!session.revokedAt)
          await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: now } });
        return { failure: 'expired' as const };
      }
      const nextRefresh = this.tokens.createRefreshToken(session.id);
      const updated = await tx.refreshSession.updateMany({
        where: {
          id: session.id,
          tokenHash: session.tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { tokenHash: this.tokens.hashRefreshToken(nextRefresh), lastUsedAt: now },
      });
      if (updated.count !== 1) {
        await tx.refreshSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.authAuditLog.create({
          data: {
            userId: session.userId,
            eventType: 'SESSION_REUSE_DETECTED',
            ...(ipAddress ? { ipAddress } : {}),
            ...(deviceInformation ? { deviceInformation } : {}),
          },
        });
        return { failure: 'reuse' as const };
      }
      await tx.authAuditLog.create({
        data: {
          userId: session.userId,
          eventType: 'SESSION_REFRESHED',
          ...(ipAddress ? { ipAddress } : {}),
          ...(deviceInformation ? { deviceInformation } : {}),
        },
      });
      return {
        sessionId: session.id,
        refreshToken: nextRefresh,
        accessToken: this.tokens.signAccessToken({
          sub: session.userId,
          sid: session.id,
          role: session.user.role,
        }),
        user: session.user,
      };
    });
    if ('failure' in result)
      throw new UnauthorizedException('Session expired. Please sign in again.');
    return result;
  }

  async revoke(sessionId: string, userId: string, ipAddress?: string, deviceInformation?: string) {
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session || session.revokedAt) return;
    await this.prisma.$transaction([
      this.prisma.refreshSession.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.authAuditLog.create({
        data: {
          userId,
          eventType: 'SESSION_REVOKED',
          ...(ipAddress ? { ipAddress } : {}),
          ...(deviceInformation ? { deviceInformation } : {}),
        },
      }),
    ]);
  }
}
