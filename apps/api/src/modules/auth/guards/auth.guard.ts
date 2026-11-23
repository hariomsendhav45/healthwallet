import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../database/prisma.service';
import { TokenService } from '../token.service';

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  doctorVerificationStatus: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | null;
}

export type AuthenticatedRequest = Request & { auth?: AuthPrincipal };

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = cookieValue(request.headers.cookie, 'hv_access');
    const claims = token ? this.tokens.verifyAccessToken(token) : null;
    if (!claims) throw new UnauthorizedException('Authentication required.');

    const session = await this.prisma.refreshSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { accountStatus: 'ACTIVE' },
      },
      select: { user: { select: { id: true, role: true, doctorVerificationStatus: true } } },
    });
    if (!session || session.user.role !== claims.role)
      throw new UnauthorizedException('Authentication required.');
    request.auth = {
      userId: session.user.id,
      sessionId: claims.sid,
      role: session.user.role,
      doctorVerificationStatus: session.user.doctorVerificationStatus,
    };
    return true;
  }
}
