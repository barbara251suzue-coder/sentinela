import 'dotenv/config';
import app from './app.js';
import { obtenerSecretoJwt } from './config.js';

try {
  obtenerSecretoJwt();
} catch (error) {
  console.error(`No se puede iniciar Sentinela: ${error.message}`);
  process.exit(1);
}

const puerto = Number(process.env.PORT || 3000);
app.listen(puerto, () => {
  console.log(`API Sentinela escuchando en http://localhost:${puerto}`);
});
