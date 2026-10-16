import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool } from '../db.js';
import { requiereAutenticacion } from '../middleware/auth.js';

const router = Router();
const tiposIncidente = [
  'espacio_seguro',
  'iluminacion_deficiente',
  'acoso_callejero',
  'otro',
];

const filtrosSchema = z.object({
  tipo: z.enum(tiposIncidente).optional(),
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
}).strict().refine(
  ({ desde, hasta }) => !desde || !hasta || new Date(desde) <= new Date(hasta),
  { message: 'La fecha desde debe ser anterior o igual a hasta' }
);

// D-05: el mapa es de Valdivia; se rechazan puntos fuera de la comuna (rectángulo aproximado).
const LIMITES_VALDIVIA = { latMin: -40.0, latMax: -39.6, lngMin: -73.5, lngMax: -72.9 };
const fueraDeValdivia = 'La ubicación debe estar dentro de la comuna de Valdivia';

// D-04: se guardan 3 decimales (~100 m) para que un punto exacto no delate el domicilio de quien reporta.
const aproximar = (valor) => Math.round(valor * 1000) / 1000;

// D-06: tope de reportes por respuesta, para no devolver la tabla completa.
const MAXIMO_REPORTES = 500;

const reporteSchema = z.object({
  tipo: z.enum(tiposIncidente),
  descripcion: z.string().trim().min(1).max(400),
  lat: z.number().finite()
    .min(LIMITES_VALDIVIA.latMin, fueraDeValdivia)
    .max(LIMITES_VALDIVIA.latMax, fueraDeValdivia)
    .transform(aproximar),
  lng: z.number().finite()
    .min(LIMITES_VALDIVIA.lngMin, fueraDeValdivia)
    .max(LIMITES_VALDIVIA.lngMax, fueraDeValdivia)
    .transform(aproximar),
  es_anonimo: z.boolean().default(false),
}).strict();

// D-03: como máximo 10 reportes publicados cada 10 minutos por cuenta (evita inundar el mapa).
// Solo cuentan las publicaciones exitosas; un formulario con errores no gasta el cupo.
const limitePublicacion = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `usuario:${req.usuarioId}`,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Publicaste muchos reportes seguidos; espera unos minutos' },
});

const nivelPorTipo = {
  espacio_seguro: 'safe',
  iluminacion_deficiente: 'care',
  acoso_callejero: 'risk',
  otro: 'risk',
};

router.use(requiereAutenticacion);

router.get('/', async (req, res, next) => {
  try {
    const filtros = filtrosSchema.parse(req.query);
    const resultado = await pool.query(
      `SELECT id, tipo_incidente, descripcion, lat, lng, es_anonimo, fecha_creacion
       FROM reportes
       WHERE ($1::text IS NULL OR tipo_incidente = $1)
         AND ($2::timestamptz IS NULL OR fecha_creacion >= $2)
         AND ($3::timestamptz IS NULL OR fecha_creacion <= $3)
       ORDER BY fecha_creacion DESC
       LIMIT $4`,
      [filtros.tipo ?? null, filtros.desde ?? null, filtros.hasta ?? null, MAXIMO_REPORTES]
    );

    const reportes = resultado.rows.map((reporte) => ({
      ...reporte,
      nivel: nivelPorTipo[reporte.tipo_incidente],
    }));
    return res.status(200).json({ reportes });
  } catch (error) {
    return next(error);
  }
});

router.post('/', limitePublicacion, async (req, res, next) => {
  try {
    const entrada = reporteSchema.parse(req.body);
    const usuarioId = entrada.es_anonimo ? null : req.usuarioId;
    const resultado = await pool.query(
      `INSERT INTO reportes (usuario_id, tipo_incidente, descripcion, lat, lng, es_anonimo)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tipo_incidente, descripcion, lat, lng, es_anonimo, fecha_creacion`,
      [
        usuarioId,
        entrada.tipo,
        entrada.descripcion,
        entrada.lat,
        entrada.lng,
        entrada.es_anonimo,
      ]
    );

    const reporte = resultado.rows[0];
    return res.status(201).json({
      reporte: {
        ...reporte,
        nivel: nivelPorTipo[reporte.tipo_incidente],
      },
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
