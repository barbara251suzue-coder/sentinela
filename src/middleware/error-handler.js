import { ZodError } from 'zod';
import { ErrorHttp } from '../errors.js';

export function manejadorErrores(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos de entrada inválidos',
      detalles: error.issues.map(({ path, message }) => ({
        campo: path.join('.'),
        mensaje: message,
      })),
    });
  }

  if (error.code === '23505') {
    return res.status(409).json({ error: 'El recurso ya existe' });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo de la solicitud supera el límite de 10kb' });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo JSON no es válido' });
  }

  if (error instanceof ErrorHttp) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error('Error interno de la API:', error);
  return res.status(500).json({ error: 'Error interno del servidor' });
}
