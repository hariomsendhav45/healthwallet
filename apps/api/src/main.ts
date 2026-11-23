import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const trustProxyHops = Number(config.get<string>('TRUST_PROXY_HOPS', '0'));
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3.');
  }
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set('trust proxy', trustProxyHops);
  app.setGlobalPrefix('api');
  const webOrigins = config
    .get<string>('WEB_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedWebOrigins = new Set(webOrigins.map((origin) => new URL(origin).origin));
  if (isProduction && [...allowedWebOrigins].some((origin) => !origin.startsWith('https://'))) {
    throw new Error('Production WEB_ORIGIN entries must use HTTPS.');
  }
  const sameSite = config.get<string>('AUTH_COOKIE_SAME_SITE', 'lax');
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none.');
  }
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.use(
    (
      request: import('express').Request,
      response: import('express').Response,
      next: () => void,
    ) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
      const cookieAuth =
        request.headers.cookie?.includes('hv_access=') ||
        request.headers.cookie?.includes('hv_refresh=');
      const origin = request.headers.origin;
      if (origin) {
        try {
          if (!allowedWebOrigins.has(new URL(origin).origin)) {
            return response
              .status(403)
              .json({ statusCode: 403, message: 'Request origin is not allowed.' });
          }
        } catch {
          return response
            .status(403)
            .json({ statusCode: 403, message: 'Request origin is not allowed.' });
        }
      } else if (cookieAuth) {
        return response
          .status(403)
          .json({ statusCode: 403, message: 'Request origin is not allowed.' });
      }
      return next();
    },
  );
  app.use((_request: import('express').Request, response: import('express').Response, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cache-Control', 'no-store');
    if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  const swagger = new DocumentBuilder()
    .setTitle('HealthVault API')
    .setDescription('HealthVault REST API foundation')
    .setVersion('0.1.0')
    .addCookieAuth('hv_access', { type: 'apiKey', in: 'cookie' })
    .build();
  if (!isProduction) SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  await app.listen(config.get<number>('API_PORT', 4000), '0.0.0.0');
}
void bootstrap();
