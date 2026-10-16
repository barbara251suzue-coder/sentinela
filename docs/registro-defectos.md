# Registro de defectos y correcciones — Sentinela

**Criterio 9 / CE 3.1.5:** corrección del código del prototipo a partir de los resultados del testing y de los estándares de seguridad ISO/IEC 27000.

**Método:**
1. Se escribieron pruebas automáticas (CP-12 a CP-17) que describen cómo *debería* comportarse el sistema.
2. Se ejecutaron sobre el código original: **11 aprobadas, 6 fallidas** (`evidencias/pruebas-antes.txt`).
3. Se corrigió el código y se repitió la ejecución: **17 de 17 aprobadas** (`evidencias/pruebas-despues.txt`).
4. El D-07 se verificó por consola, arrancando el servidor con una clave débil (`evidencias/d07-antes.txt` y `d07-despues.txt`).
5. El cambio completo de código está en `evidencias/correcciones.diff`.
6. El D-08 se detectó en las pruebas manuales de la interfaz (PM-10) y se verificó con capturas (`capturas/00-d08-antes-mapa-bloqueado.png` y la página con el mapa visible).
7. Las dependencias se revisaron con `npm audit` (`evidencias/npm-audit.txt` y `evidencias/npm-audit-produccion.txt`).

## Resumen

| ID | Defecto | Severidad | OWASP Top 10 (2021) | ISO/IEC 27001:2022 (Anexo A) | Prueba | Antes | Después | Estado |
|---|---|---|---|---|---|---|---|---|
| D-01 | La API acepta tokens JWT firmados con cualquier algoritmo HMAC (no fija HS256) | Media | A02 Fallas criptográficas · A07 Fallas de autenticación | 8.24 Uso de criptografía | CP-12 | 200 (acepta) | 401 | Corregido |
| D-02 | El token de una cuenta eliminada sigue siendo aceptado; al publicar produce **error 500** | Media | A07 Fallas de autenticación · A04 Diseño inseguro | 5.18 Derechos de acceso · 8.5 Autenticación segura | CP-13 | 500 | 401 | Corregido |
| D-03 | No hay límite de publicación: una cuenta puede inundar el mapa con reportes falsos | Alta | A04 Diseño inseguro | 8.6 Gestión de capacidad | CP-14 | 11.º reporte → 201 | 11.º reporte → 429 | Corregido |
| D-04 | Se guardan coordenadas exactas (6+ decimales): un reporte anónimo hecho desde casa puede revelar el domicilio | Alta (privacidad) | A04 Diseño inseguro | 5.34 Privacidad y protección de datos personales · 8.11 Enmascaramiento de datos | CP-15 | −39.814234 | −39.814 (~100 m) | Corregido |
| D-05 | Se aceptan ubicaciones de cualquier parte del mundo (por ejemplo, Santiago) | Baja | A04 Diseño inseguro | 8.28 Codificación segura (validación de entradas) | CP-16 | 201 | 400 | Corregido |
| D-06 | El listado devuelve todos los reportes sin tope (consumo de recursos) | Baja | A04 Diseño inseguro | 8.6 Gestión de capacidad | CP-17 | 501 de 501 | 500 de 501 | Corregido |
| D-07 | El servidor arranca con una clave JWT débil (por ejemplo, `123`), que se puede adivinar por fuerza bruta | Alta | A02 Fallas criptográficas · A05 Configuración incorrecta | 8.24 Uso de criptografía · 8.9 Gestión de la configuración | Manual (consola) | Arranca | No arranca: exige 32 caracteres | Corregido |
| D-08 | OpenStreetMap bloquea el mapa base (403 Access blocked) porque helmet envía `Referrer-Policy: no-referrer` | Media | A05 Configuración incorrecta | 8.9 Gestión de la configuración | PM-10 (manual, interfaz) | 403, mapa en blanco | Mapa visible | Corregido |
| R-01 | El registro responde 409 si el correo ya existe, lo que permite saber si una persona tiene cuenta | Baja | A07 Fallas de autenticación | 5.34 Privacidad | CP-02 | — | — | **Riesgo aceptado** |
| R-02 | `npm audit` informa 19 vulnerabilidades moderadas en `sprintf-js`, dependencia indirecta de Jest (solo pruebas) | Baja | A06 Componentes vulnerables | 8.8 Gestión de vulnerabilidades técnicas | npm audit | — | — | **Riesgo aceptado** |

**Justificación de R-01:** el registro necesita avisar a la usuaria que el correo ya está en uso. El riesgo se mitiga con el límite de 20 intentos cada 15 minutos que ya existe en `/api/auth`. Eliminarlo por completo exigiría verificar el correo por email, lo que queda fuera del alcance del prototipo.

**Justificación de R-02:** la librería afectada solo se instala para ejecutar las pruebas (devDependencies) y no llega al servidor en funcionamiento: `npm audit --omit=dev` informa **0 vulnerabilidades**. La corrección automática (`npm audit fix --force`) bajaría Jest a la versión 25, lo que podría romper las pruebas. Se revisará cuando Jest publique una versión que actualice la dependencia.

---

## Detalle: antes y después

### D-01 · Algoritmo JWT no fijado — `src/middleware/auth.js`, `src/routes/auth.js`

**Antes:** se verificaba el token sin indicar el algoritmo, así que se aceptaba un token firmado con HS512.
```js
const claims = tokenSchema.safeParse(jwt.verify(token, secreto));
```
**Después:** se firma y se verifica solo con HS256 (`src/config.js` define `ALGORITMO_JWT`).
```js
jwt.verify(token, obtenerSecretoJwt(), { algorithms: [ALGORITMO_JWT] });
jwt.sign({ sub: String(usuario.id) }, obtenerSecretoJwt(), { algorithm: ALGORITMO_JWT, expiresIn: '2h' });
```

### D-02 · Token de una cuenta eliminada — `src/middleware/auth.js`

**Antes:** bastaba con que la firma fuera válida. Al publicar, PostgreSQL rechazaba la clave foránea y la API respondía **500 Error interno**, una falla no controlada que además queda en el log.

**Después:** se comprueba que la cuenta exista antes de dar acceso.
```js
const usuario = await pool.query('SELECT id FROM usuarios WHERE id = $1', [claims.data.sub]);
if (usuario.rowCount === 0) {
  return next(new ErrorHttp(401, 'La cuenta ya no existe'));
}
```

### D-03 · Sin límite de publicación — `src/routes/reportes.js`

**Antes:** `router.post('/', async (req, res, next) => { ... })` no tenía ninguna restricción.

**Después:** como máximo 10 reportes exitosos cada 10 minutos por cuenta. Los formularios con errores no consumen el cupo.
```js
const limitePublicacion = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 10,
  keyGenerator: (req) => `usuario:${req.usuarioId}`,
  skipFailedRequests: true, ...
});
router.post('/', limitePublicacion, async (req, res, next) => { ... });
```

### D-04 · Coordenadas exactas — `src/routes/reportes.js`

**Antes:** `lat: z.number().finite().min(-90).max(90)` guardaba el punto tal como llegaba.

**Después:** se redondea a 3 decimales (unos 100 m) antes de guardar. Esto aplica **privacidad desde el diseño** (Ley 19.628 y Ley 21.719 de protección de datos personales).
```js
const aproximar = (valor) => Math.round(valor * 1000) / 1000;
lat: z.number().finite().min(...).max(...).transform(aproximar),
```

### D-05 · Ubicaciones fuera de Valdivia — `src/routes/reportes.js`

**Antes:** se aceptaba todo el rango geográfico (−90..90 y −180..180).

**Después:** se acepta solo el rectángulo de la comuna de Valdivia (lat −40,0 a −39,6; lng −73,5 a −72,9). La página muestra *"Elige una ubicación dentro de la comuna de Valdivia."*

### D-06 · Listado sin tope — `src/routes/reportes.js`

**Antes:** `ORDER BY fecha_creacion DESC` sin límite.

**Después:** `ORDER BY fecha_creacion DESC LIMIT $4`, con `MAXIMO_REPORTES = 500`.

### D-07 · Clave JWT débil — `src/server.js`, nuevo `src/config.js`

**Antes:** solo se comprobaba que `JWT_SECRET` no estuviera vacío.
```
$ JWT_SECRET=123 node src/server.js
API Sentinela escuchando en http://localhost:3999
```
**Después:** se exigen al menos 32 caracteres, equivalentes a los 256 bits de HS256.
```
$ JWT_SECRET=123 node src/server.js
No se puede iniciar Sentinela: JWT_SECRET debe tener al menos 32 caracteres (configúralo en el archivo .env)
```

### D-08 · Mapa base bloqueado por OpenStreetMap — `src/app.js`

**Antes:** helmet aplica por defecto `Referrer-Policy: no-referrer`. La política de uso de mosaicos de OpenStreetMap exige identificar el sitio de origen, así que respondía **403 Access blocked** y el mapa se veía en blanco.

**Después:** se envía solo el origen (`http://localhost:3000`) a otros sitios, nunca la ruta completa, para no exponer información de navegación.
```js
app.use(helmet({
  contentSecurityPolicy: { ... },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
```
