import 'dotenv/config';

// D-07: una clave corta (por ejemplo "123") permite adivinar la firma de los tokens por fuerza bruta.
// HS256 usa una clave de 256 bits, así que se exigen al menos 32 caracteres.
export const LARGO_MINIMO_SECRETO = 32;

// D-01: se fija el algoritmo para que la API no acepte tokens firmados de otra forma.
export const ALGORITMO_JWT = 'HS256';

export function obtenerSecretoJwt() {
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < LARGO_MINIMO_SECRETO) {
    throw new Error(
      `JWT_SECRET debe tener al menos ${LARGO_MINIMO_SECRETO} caracteres (configúralo en el archivo .env)`
    );
  }
  return secreto;
}
