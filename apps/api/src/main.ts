import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[api] e-Click Active API listening on http://localhost:${port}`);
}

void bootstrap();
