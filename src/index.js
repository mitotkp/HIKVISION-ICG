import express from 'express';
import accessRoutes from './routes/access.routes.js';
import { getConnection } from './config/db.js';

const app = express();
const PORT = 6060;

app.use((req, res, next) => {
  console.log(`\nConexión recibida!`);
  console.log(`   IP Origen: ${req.ip}`);
  console.log(`   Tipo Contenido: ${req.headers['content-type']}`);
  next();
})

app.use(express.json());

app.use('/api/hikvision', accessRoutes);

const startServer = async () => {
  try {

    await getConnection();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
    Servidor corriendo en el puerto ${PORT}

    Documentación: 
    Endpoint: POST /api/hikvision/event
    `);
    });

  }
  catch (error) {
    console.error('Error al iniciar el servidor:', error.message);
    process.exit(1);
  }
}

startServer();

