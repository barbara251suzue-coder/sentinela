CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    rol VARCHAR(30) NOT NULL DEFAULT 'usuario',
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reportes (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo_incidente VARCHAR(40) NOT NULL
        CHECK (tipo_incidente IN (
            'espacio_seguro',
            'iluminacion_deficiente',
            'acoso_callejero',
            'otro'
        )),
    descripcion VARCHAR(400) NOT NULL
        CHECK (char_length(descripcion) BETWEEN 1 AND 400),
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    es_anonimo BOOLEAN NOT NULL DEFAULT FALSE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reportes_tipo_fecha
    ON reportes (tipo_incidente, fecha_creacion DESC);

CREATE INDEX IF NOT EXISTS idx_reportes_fecha
    ON reportes (fecha_creacion DESC);
