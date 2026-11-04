import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ApiRequestError,
  errorMessageOf,
  messageFromErrorBody,
  toApiError,
} from './api-errors.ts'
import { API_ERROR_MESSAGES } from './constants.ts'

const body = (message: unknown, code = 'bad-request') => ({ code, errors: [{ message }] })

test('4xx con errors[0].message: se usa ese texto', () => {
  assert.equal(messageFromErrorBody(400, body('Falta el profesional.')), 'Falta el profesional.')
  assert.equal(
    messageFromErrorBody(409, body('Ya existe un profesional con ese CUIT.', 'conflict')),
    'Ya existe un profesional con ese CUIT.',
  )
})

test('5xx: siempre el generico del servidor, aunque el backend mande otro texto', () => {
  assert.equal(messageFromErrorBody(500, body('algo interno')), API_ERROR_MESSAGES.server)
  assert.equal(messageFromErrorBody(503, null), API_ERROR_MESSAGES.server)
})

test('404: no encontrado', () => {
  assert.equal(messageFromErrorBody(404, body('No se encontró el recurso.', 'not-found')), API_ERROR_MESSAGES.notFound)
})

test('validation-failed: el generico en espanol, no los mensajes en ingles de class-validator', () => {
  assert.equal(
    messageFromErrorBody(400, body('user must be a string', 'validation-failed')),
    API_ERROR_MESSAGES.validation,
  )
})

test('cuerpos sin mensaje usable: generico del status', () => {
  assert.equal(messageFromErrorBody(400, null), API_ERROR_MESSAGES.badRequest)
  assert.equal(messageFromErrorBody(400, 'texto'), API_ERROR_MESSAGES.badRequest)
  assert.equal(messageFromErrorBody(409, { code: 'conflict', errors: [] }), API_ERROR_MESSAGES.conflict)
  assert.equal(messageFromErrorBody(400, body(42)), API_ERROR_MESSAGES.badRequest)
  assert.equal(messageFromErrorBody(400, body('   ')), API_ERROR_MESSAGES.badRequest)
  assert.equal(messageFromErrorBody(413, {}), API_ERROR_MESSAGES.payloadTooLarge)
  assert.equal(messageFromErrorBody(429, undefined), API_ERROR_MESSAGES.tooManyRequests)
  assert.equal(messageFromErrorBody(418, null), API_ERROR_MESSAGES.generic)
})

test('un mensaje de 1000 caracteres se recorta', () => {
  assert.equal(messageFromErrorBody(400, body('x'.repeat(1000))).length, 300)
})

test('ignora details y el message de nivel superior', () => {
  assert.equal(
    messageFromErrorBody(400, { code: 'x', details: '{"message":"interno"}', message: 'superior' }),
    API_ERROR_MESSAGES.badRequest,
  )
})

test('toApiError: status, code y mensaje de un JSON', async () => {
  const res = new Response(JSON.stringify(body('Ya existe.', 'conflict')), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  })
  const err = await toApiError(res)
  assert.ok(err instanceof ApiRequestError)
  assert.ok(err instanceof Error)
  assert.equal(err.name, 'ApiRequestError')
  assert.equal(err.status, 409)
  assert.equal(err.code, 'conflict')
  assert.equal(err.message, 'Ya existe.')
})

test('toApiError: cuerpo que no es JSON usa el generico y no muestra el texto', async () => {
  const err = await toApiError(new Response('<html>Bad gateway</html>', { status: 502 }))
  assert.equal(err.status, 502)
  assert.equal(err.code, null)
  assert.equal(err.message, API_ERROR_MESSAGES.server)
})

test('errorMessageOf: ApiRequestError da su mensaje; otros errores, el fallback', () => {
  assert.equal(errorMessageOf(new ApiRequestError(400, null, 'Mensaje'), 'Fallback'), 'Mensaje')
  assert.equal(errorMessageOf(new TypeError('Failed to fetch'), 'Fallback'), 'Fallback')
  assert.equal(errorMessageOf(new Error('Failed to create payer: {"a":1}'), 'Fallback'), 'Fallback')
  assert.equal(errorMessageOf('texto', 'Fallback'), 'Fallback')
})

// Estatico sobre data.ts: no vuelve a armar mensajes en ingles ni con el cuerpo crudo.
const dataSource = readFileSync(new URL('../services/data.ts', import.meta.url), 'utf8')

test('data.ts no arma "Failed to ...", ni lee el cuerpo como texto, ni usa details', () => {
  assert.equal(dataSource.includes('Failed to'), false)
  assert.equal(dataSource.includes('.text()'), false)
  assert.equal(dataSource.includes('details'), false)
})
