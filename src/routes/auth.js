import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db.js';
import { ErrorHttp } from '../errors.js';
import { ALGORITMO_JWT, obtenerSecretoJwt } from '../config.js';

const router = Router();
const hashParaCredencialInvalida = bcrypt.hash('sentinela-credencial-no-valida', 12);
const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
const claveSchema = z.string().min(8).max(72).refine(
  (clave) => Buffer.byteLength(clave, 'utf8') <= 72,
  'La contraseña no puede superar 72 bytes'
);
const registroSchema = z.object({
  email: emailSchema,
  contraseña: claveSchema,
  nombre: z.string().trim().min(1).max(120),
}).strict();
const loginSchema = z.object({
  email: emailSchema,
  contraseña: claveSchema,
}).strict();

router.post('/registro', async (req, res, next) => {
  try {
    const entrada = registroSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(entrada.contraseña, 12);
    const resultado = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre)
       VALUES ($1, $2, $3)
       RETURNING id, email, nombre, rol, fecha_registro`,
      [entrada.email, passwordHash, entrada.nombre]
    );

    return res.status(201).json({ usuario: resultado.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const entrada = loginSchema.parse(req.body);
    const resultado = await pool.query(
      'SELECT id, email, password_hash, nombre, rol FROM usuarios WHERE email = $1',
      [entrada.email]
    );
    const usuario = resultado.rows[0];
    const claveValida = usuario
      ? await bcrypt.compare(entrada.contraseña, usuario.password_hash)
      : await bcrypt.compare(entrada.contraseña, await hashParaCredencialInvalida);

    if (!usuario || !claveValida) {
      throw new ErrorHttp(401, 'Credenciales inválidas');
    }

    const token = jwt.sign({ sub: String(usuario.id) }, obtenerSecretoJwt(), {
      algorithm: ALGORITMO_JWT,
      expiresIn: '2h',
    });
    return res.status(200).json({
      token,
      tipo: 'Bearer',
      expira_en: '2h',
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
