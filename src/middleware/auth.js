import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db.js';
import { ErrorHttp } from '../errors.js';
import { ALGORITMO_JWT, obtenerSecretoJwt } from '../config.js';

const encabezadoSchema = z.string().regex(/^Bearer\s+\S+$/i);
const tokenSchema = z.object({
  sub: z.string().regex(/^\d+$/),
});

export async function requiereAutenticacion(req, res, next) {
  const resultado = encabezadoSchema.safeParse(req.get('authorization'));
  if (!resultado.success) {
    return next(new ErrorHttp(401, 'Se requiere autenticación'));
  }

  const token = resultado.data.replace(/^Bearer\s+/i, '');

  let claims;
  try {
    // D-01: solo se aceptan tokens firmados con HS256.
    claims = tokenSchema.safeParse(jwt.verify(token, obtenerSecretoJwt(), { algorithms: [ALGORITMO_JWT] }));
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return next(new ErrorHttp(401, 'Token inválido o expirado'));
    }
    return next(error);
  }
  if (!claims.success) {
    return next(new ErrorHttp(401, 'Token inválido'));
  }

  try {
    // D-02: un token válido de una cuenta eliminada ya no da acceso (antes terminaba en error 500).
    const usuario = await pool.query('SELECT id FROM usuarios WHERE id = $1', [claims.data.sub]);
    if (usuario.rowCount === 0) {
      return next(new ErrorHttp(401, 'La cuenta ya no existe'));
    }
  } catch (error) {
    return next(error);
  }

  req.usuarioId = Number(claims.data.sub);
  return next();
}
