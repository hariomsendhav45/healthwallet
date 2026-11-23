import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';

@Injectable()
export class PatientProfileRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: SecurityRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const ip = request.ip ?? 'unknown';
    const userId = request.auth?.userId ?? 'anonymous';
    this.limiter.consume(`patient-api:user:${userId}`, 120, 5 * 60_000);
    this.limiter.consume(`patient-api:ip:${ip}`, 300, 5 * 60_000);
    return true;
  }
}
