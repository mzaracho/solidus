/**
 * Feature 021, regresión de GHSA-27r3-jxmh-p828 (body-parser < 1.20.9): un request sin autenticar con
 * `Content-Encoding: gzip` y bytes de más después del cuerpo comprimido dejaba un error sin manejar en el
 * stream de zlib y el proceso del backend terminaba. Con la versión corregida el parser responde con un error
 * del cliente (o procesa el cuerpo) y el proceso sigue vivo.
 */
import { Body, Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AddressInfo, connect } from 'net';
import { gzipSync } from 'zlib';
import request from 'supertest';
import { configureBodyParser } from './body-parser-config';

@Controller('probe')
class ProbeController {
  @Post('echo')
  echo(@Body() body: unknown) {
    return { received: body !== undefined };
  }
}

const CRLF = '\r\n';

/**
 * Envía un frame gzip válido y, DESPUÉS de que el servidor ya lo procesó, los bytes de más (como describe el
 * aviso: llegan al decodificador ya terminado). Devuelve el estado de la respuesta, si hubo.
 */
function sendGzipWithTrailingBytes(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const frame = gzipSync('{"a":1}');
    const trailing = Buffer.from('bytes-de-mas');
    const socket = connect(port, '127.0.0.1', () => {
      const head = [
        'POST /probe/echo HTTP/1.1',
        'Host: localhost',
        'Content-Type: application/json',
        'Content-Encoding: gzip',
        `Content-Length: ${frame.length + trailing.length}`,
        'Connection: close',
        '',
        '',
      ].join(CRLF);
      socket.write(head);
      socket.write(frame);
      setTimeout(() => socket.write(trailing), 150);
    });
    let received = '';
    socket.on('data', (chunk) => (received += chunk.toString('latin1')));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      const match = /^HTTP\/1\.1 (\d{3})/.exec(received);
      resolve(match ? Number(match[1]) : null);
    });
    setTimeout(() => socket.destroy(), 1500);
  });
}

describe('body-parser: gzip con bytes de más (GHSA-27r3)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureBodyParser(app, {
      get: () => undefined,
    } as unknown as ConfigService);
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('no deja una excepción sin manejar y el servidor sigue respondiendo', async () => {
    const server = app.getHttpServer();
    const { port } = server.address() as AddressInfo;
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    try {
      const status = await sendGzipWithTrailingBytes(port);
      // Un ciclo extra del event loop para que aflore un error asíncrono del stream.
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (status !== null) expect(status).toBeLessThan(500);
      expect(uncaught).toEqual([]);

      const ok = await request(server).post('/probe/echo').send({ a: 1 });
      expect(ok.status).toBe(201);
      expect(ok.body).toEqual({ received: true });
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
