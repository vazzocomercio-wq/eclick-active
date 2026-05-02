import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { resolveCorsOrigins } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS — aceita lista explícita (CORS_ORIGINS env, separado por vírgula)
  // ou cai pro default (localhost:3000 + domínios de produção).
  const allowedOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Requests same-origin ou tools tipo Postman não mandam Origin
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS bloqueado: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`[api] e-Click Active API listening on port ${port}`);
  console.log(`[api] CORS allowed origins: ${allowedOrigins.join(', ')}`);
}

void bootstrap();
