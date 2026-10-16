import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import request from 'supertest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { pool } from '../src/db.js';

const rutaSchema = fileURLToPath(new URL('../schema.sql', import.meta.url));
const claveDePrueba = 'ClaveSegura123';
let token;
let usuarioId;
let hashClaveDePrueba;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).pathname.replace(/^\//, '') !== 'sentinela_test') {
    throw new Error('Las pruebas requieren DATABASE_URL apuntando a la base sentinela_test');
  }

  const schema = await readFile(rutaSchema, 'utf8');
  await pool.query(schema);
  hashClaveDePrueba = await bcrypt.hash(claveDePrueba, 12);
});

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE reportes, usuarios RESTART IDENTITY CASCADE');
  const resultado = await pool.query(
    `INSERT INTO usuarios (email, password_hash, nombre)
     VALUES ($1, $2, $3)
     RETURNING id`,
    ['prueba@sentinela.cl', hashClaveDePrueba, 'Usuaria de prueba']
  );
  usuarioId = resultado.rows[0].id;
  token = jwt.sign({ sub: String(usuarioId) }, process.env.JWT_SECRET, { expiresIn: '2h' });
});

afterAll(async () => {
  await pool.end();
});

describe('API Sentinela', () => {
  test('CP-01 RF-01: registra una usuaria y almacena la contraseña cifrada', async () => {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({
        email: 'nueva@sentinela.cl',
        contraseña: claveDePrueba,
        nombre: 'Nueva usuaria',
      });
    const resultado = await pool.query(
      'SELECT password_hash FROM usuarios WHERE email = $1',
      ['nueva@sentinela.cl']
    );
    expect(respuesta.status).toBe(201);
    expect(resultado.rows[0].password_hash).not.toBe(claveDePrueba);
    expect(resultado.rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
  });

  test('CP-02 RF-01: rechaza un email duplicado con 409', async () => {
    const respuesta = await request(app)
      .post('/api/auth/registro')
      .send({
        email: 'prueba@sentinela.cl',
        contraseña: 'ClaveSegura123',
        nombre: 'Duplicada',
      });
    expect(respuesta.status).toBe(409);
  });

  test('CP-03 RF-02: inicia sesión y emite un JWT con expiración de dos horas', async () => {
    const respuesta = await request(app)
      .post('/api/auth/login')
      .send({ email: 'prueba@sentinela.cl', contraseña: claveDePrueba });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.token).toEqual(expect.any(String));
    expect(respuesta.body.expira_en).toBe('2h');
    const claims = jwt.decode(respuesta.body.token);
    expect(claims.exp - claims.iat).toBe(7200);
  });

  test('CP-04 RF-02: responde Credenciales inválidas ante una clave incorrecta', async () => {
    const respuesta = await request(app)
      .post('/api/auth/login')
      .send({ email: 'prueba@sentinela.cl', contraseña: 'ClaveIncorrecta123' });
    expect(respuesta.status).toBe(401);
    expect(respuesta.body.error).toBe('Credenciales inválidas');
  });

  test('CP-05 RF-03: rechaza listar reportes sin token', async () => {
    const respuesta = await request(app).get('/api/reportes');
    expect(respuesta.status).toBe(401);

    const creacion = await request(app)
      .post('/api/reportes')
      .send({
        tipo: 'otro',
        descripcion: 'Intento sin autenticación',
        lat: -39.8,
        lng: -73.2,
      });
    expect(creacion.status).toBe(401);
  });

  test('CP-06 RF-04: rechaza una latitud fuera de rango', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'otro',
        descripcion: 'Ubicación de prueba',
        lat: 91,
        lng: -73.2,
      });
    expect(respuesta.status).toBe(400);
  });

  test('CP-07 RF-04: rechaza una descripción vacía', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'otro', descripcion: '   ', lat: -39.8, lng: -73.2 });
    expect(respuesta.status).toBe(400);
  });

  test('CP-08 RF-04: rechaza una descripción de más de 400 caracteres', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'otro',
        descripcion: 'a'.repeat(401),
        lat: -39.8,
        lng: -73.2,
      });
    expect(respuesta.status).toBe(400);
  });

  test('CP-09 RF-05: persiste usuario_id NULL y no expone identidad en reporte anónimo', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'espacio_seguro',
        descripcion: 'Espacio seguro reportado',
        lat: -39.8,
        lng: -73.2,
        es_anonimo: true,
      });
    const guardado = await pool.query(
      'SELECT usuario_id FROM reportes WHERE id = $1',
      [respuesta.body.reporte?.id]
    );

    expect(respuesta.status).toBe(201);
    expect(guardado.rows[0].usuario_id).toBeNull();
    expect(respuesta.body.reporte).not.toHaveProperty('usuario_id');
    expect(respuesta.body.reporte).not.toHaveProperty('email');
    expect(respuesta.body.reporte.nivel).toBe('safe');

    const listado = await request(app)
      .get('/api/reportes')
      .set('Authorization', `Bearer ${token}`);
    expect(listado.body.reportes[0]).not.toHaveProperty('usuario_id');
    expect(listado.body.reportes[0]).not.toHaveProperty('email');
  });

  test('CP-10 RF-06: filtra el listado por tipo y rango de fechas', async () => {
    await pool.query(
      `INSERT INTO reportes
        (usuario_id, tipo_incidente, descripcion, lat, lng, fecha_creacion)
       VALUES
        ($1, 'acoso_callejero', 'Dentro del rango', -39.8, -73.2, '2025-05-10T12:00:00Z'),
        ($1, 'otro', 'Tipo distinto', -39.8, -73.2, '2025-05-10T12:00:00Z'),
        ($1, 'acoso_callejero', 'Fuera del rango', -39.8, -73.2, '2025-04-10T12:00:00Z')`,
      [usuarioId]
    );
    const respuesta = await request(app)
      .get('/api/reportes?tipo=acoso_callejero&desde=2025-05-01T00:00:00Z&hasta=2025-05-31T23:59:59Z')
      .set('Authorization', `Bearer ${token}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.reportes).toHaveLength(1);
    expect(respuesta.body.reportes[0].descripcion).toBe('Dentro del rango');
  });

  test('CP-11 RF-09: asigna el nivel correspondiente a cada tipo de reporte', async () => {
    const casos = [
      ['espacio_seguro', 'safe'],
      ['iluminacion_deficiente', 'care'],
      ['acoso_callejero', 'risk'],
      ['otro', 'risk'],
    ];
    for (const [tipo, nivel] of casos) {
      await pool.query(
        `INSERT INTO reportes (usuario_id, tipo_incidente, descripcion, lat, lng)
         VALUES ($1, $2, $3, -39.8, -73.2)`,
        [usuarioId, tipo, `Reporte ${tipo}`]
      );
      const respuesta = await request(app)
        .get(`/api/reportes?tipo=${tipo}`)
        .set('Authorization', `Bearer ${token}`);
      expect(respuesta.body.reportes[0].nivel).toBe(nivel);
    }
  });

});

describe('Seguridad y defectos (Paso 3)', () => {
  test('CP-12 RNF-03 (D-01): rechaza un JWT firmado con un algoritmo distinto a HS256', async () => {
    const tokenHs512 = jwt.sign({ sub: String(usuarioId) }, process.env.JWT_SECRET, {
      algorithm: 'HS512',
      expiresIn: '2h',
    });
    const respuesta = await request(app)
      .get('/api/reportes')
      .set('Authorization', `Bearer ${tokenHs512}`);
    expect(respuesta.status).toBe(401);
  });

  test('CP-13 RF-02 (D-02): rechaza con 401 el token de una cuenta que ya no existe', async () => {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'otro', descripcion: 'Cuenta eliminada', lat: -39.8, lng: -73.2 });
    expect(respuesta.status).toBe(401);
  });

  test('CP-14 RF-04 (D-03): limita la publicación a 10 reportes cada 10 minutos por usuaria', async () => {
    const otra = await pool.query(
      `INSERT INTO usuarios (email, password_hash, nombre) VALUES ($1, $2, $3) RETURNING id`,
      ['limite@sentinela.cl', hashClaveDePrueba, 'Límite']
    );
    const tokenOtra = jwt.sign({ sub: String(otra.rows[0].id) }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const estados = [];
    for (let i = 0; i < 11; i += 1) {
      const respuesta = await request(app)
        .post('/api/reportes')
        .set('Authorization', `Bearer ${tokenOtra}`)
        .send({ tipo: 'otro', descripcion: `Reporte ${i}`, lat: -39.8, lng: -73.2 });
      estados.push(respuesta.status);
    }
    expect(estados.slice(0, 10).every((estado) => estado === 201)).toBe(true);
    expect(estados[10]).toBe(429);
  });

  test('CP-15 RF-05 (D-04): guarda la ubicación aproximada (3 decimales, ~100 m)', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'acoso_callejero', descripcion: 'Ubicación precisa', lat: -39.814234, lng: -73.245987, es_anonimo: true });
    const guardado = await pool.query('SELECT lat, lng FROM reportes WHERE id = $1', [respuesta.body.reporte?.id]);
    expect(respuesta.status).toBe(201);
    expect(guardado.rows[0]).toEqual({ lat: -39.814, lng: -73.246 });
  });

  test('CP-16 RF-03 (D-05): rechaza ubicaciones fuera de Valdivia', async () => {
    const respuesta = await request(app)
      .post('/api/reportes')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'otro', descripcion: 'Santiago centro', lat: -33.4372, lng: -70.6506 });
    expect(respuesta.status).toBe(400);
  });

  test('CP-17 RNF-01 (D-06): el listado devuelve como máximo 500 reportes', async () => {
    await pool.query(
      `INSERT INTO reportes (usuario_id, tipo_incidente, descripcion, lat, lng)
       SELECT $1, 'otro', 'Masivo ' || n, -39.8, -73.2 FROM generate_series(1, 501) AS n`,
      [usuarioId]
    );
    const respuesta = await request(app)
      .get('/api/reportes')
      .set('Authorization', `Bearer ${token}`);
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.reportes).toHaveLength(500);
  });
});
