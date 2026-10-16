# Sentinela · Mapa colaborativo de seguridad (Valdivia)

Un solo proyecto: el servidor Express entrega la página del mapa y la API, con PostgreSQL como base de datos.

## Estructura

```
sentinela/
├── public/          ← lo que ve el navegador
│   ├── index.html   (página)
│   ├── styles.css   (diseño)
│   └── app.js       (lógica del mapa)
├── src/             ← el servidor (backend)
│   ├── server.js    (arranca el servidor)
│   ├── app.js       (configuración y seguridad)
│   ├── db.js        (conexión a PostgreSQL)
│   ├── routes/      (auth.js = registro/login, reportes.js)
│   └── middleware/  (auth.js = token, error-handler.js)
├── tests/           ← pruebas automáticas (Jest)
├── schema.sql       ← tablas de la base de datos
├── .env.example     ← plantilla de configuración
└── package.json
```

## Instalación (una sola vez)a

Requisitos: Node.js 20+ y PostgreSQL 14+.

```powershell
# 1) Crear las bases de datos (reemplaza la ruta de psql si hace falta)
psql -U postgres -h localhost -c "CREATE DATABASE sentinela;"
psql -U postgres -h localhost -c "CREATE DATABASE sentinela_test;"
psql -U postgres -h localhost -d sentinela      -f .\schema.sql
psql -U postgres -h localhost -d sentinela_test -f .\schema.sql

# 2) Instalar dependencias y crear tu archivo de configuración
npm install
Copy-Item .env.example .env
```

Abre `.env` y completa:

- `DATABASE_URL` con tu clave de Postgres.
- `JWT_SECRET` con un texto aleatorio de **al menos 32 caracteres** (obligatorio; si es más corto el servidor no parte).

## Ejecutar

```powershell
npm start
```

Abre <http://localhost:3000>. Para comprobar la API: <http://localhost:3000/api/salud> debe responder `{"estado":"ok"}`.

## Pruebas

```powershell
$env:DATABASE_URL = "postgresql://postgres:tu_clave@localhost:5432/sentinela_test"
$env:JWT_SECRET   = "clave_temporal_solo_para_pruebas"
npm test
```

Las pruebas vacían las tablas: úsalas **solo** con la base `sentinela_test`.
Son 17 casos (CP-01 a CP-17); el resultado esperado es `Tests: 17 passed, 17 total`.

## Estado

- [x] Paso 1 · Proyecto ordenado en una sola carpeta.
- [x] Paso 2 · Página conectada a la API: registro, login (JWT en `sessionStorage`), cierre de sesión,
      mapa con reportes reales desde PostgreSQL, publicación de reportes con opción anónima y
      validación en el cliente (la API vuelve a validar en el servidor). Si el token expira, vuelve al login.
- [x] Paso 3 · 8 defectos corregidos con antes y después (CP-12 a CP-17, D-07 manual y D-08 en la interfaz)
      y 2 riesgos aceptados (R-01, R-02). Ver `docs/registro-defectos.md` y `docs/evidencias/`.
- [x] Paso 4 · Tabla de pruebas con evidencia: 17 automáticas (17/17 aprobadas) y 10 manuales,
      con capturas en `docs/capturas/`.
- [x] Paso 5 · Informe técnico final: `docs/Sentinela_Informe_Tecnico_Unidad3.docx`.
- [x] Paso 6 · Demo preparada (guion, comandos y pruebas en vivo).
