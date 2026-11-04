/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { finalErrorHandler } from './final-error-handler';
import { GENERIC_ERRORS } from './error-contract';

describe('finalErrorHandler', () => {
  const fakeRes = (headersSent = false) => {
    const res: any = {
      headersSent,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn(),
    };
    return res as Response & Record<string, jest.Mock>;
  };
  const req = { method: 'GET', originalUrl: '/x?secreto=1' } as Request;

  it('responde el contrato genérico, con X-Error-Id, y no llama a next', () => {
    const res = fakeRes();
    const next = jest.fn() as unknown as NextFunction;
    finalErrorHandler(new Error('interno secreto'), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'unhandled-exception',
      errors: [{ message: GENERIC_ERRORS[500][1] }],
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Error-Id',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('con headersSent solo cierra la respuesta', () => {
    const res = fakeRes(true);
    finalErrorHandler(new Error('x'), req, res, jest.fn());
    expect(res.end).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('en Express sin Nest: un middleware que falla devuelve JSON, nunca HTML', async () => {
    const app = express();
    app.get('/falla', () => {
      throw Object.assign(new Error('detalle interno'), { status: 502 });
    });
    app.use(finalErrorHandler);
    const res = await request(app).get('/falla');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'errors']);
    expect(res.text).not.toMatch(/detalle interno|<html|stack/i);
  });

  it('un 4xx de http-errors con expose conserva el status y es genérico', async () => {
    const app = express();
    app.get('/malo', () => {
      throw Object.assign(new Error('Unexpected token'), {
        status: 400,
        expose: true,
      });
    });
    app.use(finalErrorHandler);
    const res = await request(app).get('/malo');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'bad-request',
      errors: [{ message: GENERIC_ERRORS[400][1] }],
    });
  });
});
