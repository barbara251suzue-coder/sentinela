import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import authRoutes from './routes/auth.js';
import reportesRoutes from './routes/reportes.js';
import { pool } from './db.js';
import { manejadorErrores } from './middleware/error-handler.js';

export const app = express();

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const saludQuerySchema = z.object({}).strict();
const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos; inténtalo más tarde' },
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // Los mosaicos del mapa vienen de OpenStreetMap; todo lo demás es del propio servidor.
      'img-src': ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
      // Sin esto el navegador intenta forzar https también en http://localhost.
      'upgrade-insecure-requests': null,
    },
  },
  // D-08: helmet usa 'no-referrer' por defecto y OpenStreetMap bloquea (403) los mosaicos sin Referer.
  // Se envía solo el origen (http://localhost:3000) a otros sitios, nunca la ruta completa.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || false,
}));
app.use(express.json({ limit: '10kb' }));

// Páginas y librerías del navegador (Leaflet y Lucide se sirven desde node_modules, sin CDN).
app.use(express.static(path.join(raiz, 'public')));
app.use('/vendor/leaflet', express.static(path.join(raiz, 'node_modules/leaflet/dist')));
app.use('/vendor/lucide', express.static(path.join(raiz, 'node_modules/lucide/dist/umd')));

app.get('/api/salud', async (req, res, next) => {
  try {
    saludQuerySchema.parse(req.query);
    await pool.query('SELECT 1');
    return res.status(200).json({ estado: 'ok' });
  } catch (error) {
    return next(error);
  }
});

app.use('/api/auth', limiteAuth, authRoutes);
app.use('/api/reportes', reportesRoutes);
app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use(manejadorErrores);

export default app;
