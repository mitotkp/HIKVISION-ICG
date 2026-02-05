import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'; // Para leer .env si no se usa el flag nativo
import cron from 'node-cron';

// Importaciones de tus rutas y servicios
import accessRoutes from './routes/access.routes.js';
import { getConnection } from './config/db.js';
import { cSyncService } from './services/sync.service.js';
import { cAccessService } from './services/access.service.js';

// Configuración de rutas de archivos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

// 1. Cargar configuración .env
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const app = express();
// 2. Usar el puerto del .env (o 6060 por defecto)
const PORT = process.env.PORT || 6060;

// --- Middlewares ---
app.use(cors());
// Aumentamos el límite para fotos grandes si hiciera falta
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Log básico de peticiones (útil para depurar)
app.use((req, res, next) => {
  // Ignoramos logs de archivos estáticos para no ensuciar la consola
  if (!req.url.startsWith('/uploads') && !req.url.startsWith('/assets')) {
    // console.log(`📡 [${req.method}] ${req.url} - IP: ${req.ip}`);
  }
  next();
});

// --- Servir Archivos Estáticos ---
// 1. La página web (Frontend)
app.use(express.static(path.join(__dirname, 'public')));
// 2. Las fotos (Uploads)
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Instancias de Servicios ---
const syncService = new cSyncService();
const accessService = new cAccessService();
// Configuración temporal de Multer para subidas manuales
const upload = multer({ storage: multer.memoryStorage() });

// --- RUTAS Y ENDPOINTS ---

// 1. Rutas Originales de Hikvision (Eventos)
app.use('/api/hikvision', accessRoutes);

// 2. Sincronización Manual (SSE - Barra de Progreso)
app.get('/api/sync-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const clientes = await syncService.obtenerClientes();
        res.write(`data: ${JSON.stringify({ tipo: 'inicio', total: clientes.length })}\n\n`);

        await syncService.enviarClientes(clientes, (progreso) => {
            const payload = JSON.stringify({ 
                tipo: 'progreso', 
                actual: progreso.actual, 
                total: progreso.total,
                nombre: progreso.nombre
            });
            res.write(`data: ${payload}\n\n`);
        });

        res.write(`data: ${JSON.stringify({ tipo: 'fin' })}\n\n`);
        res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ tipo: 'error', msg: error.message })}\n\n`);
        res.end();
    }
});

// 3. API para el Frontend (Clientes, Fotos, Tarjetas)
app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await syncService.obtenerClientes();
        res.json(clientes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cliente/:id/foto', upload.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });
        await syncService.subirRostro(req.params.id, req.file.buffer);
        res.json({ success: true, message: 'Foto actualizada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cliente/:id/foto', async (req, res) => {
    try {
        const result = await syncService.verificarRostro(req.params.id);
        res.json({ hasPhoto: result.hasFace, photoUrl: result.faceUrl });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/cliente/:id/foto', async (req, res) => {
    try {
        await syncService.eliminarRostro(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Tarjetas
app.post('/api/cliente/:id/tarjeta', async (req, res) => {
    try {
        await syncService.vincularTarjeta(req.params.id, req.body.tarjeta);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/cliente/:id/tarjetas', async (req, res) => {
    try {
        const tarjetas = await syncService.obtenerTarjetasDelDispositivo(req.params.id);
        res.json({ tarjetas });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/cliente/:id/tarjeta/:cardNo', async (req, res) => {
    try {
        await syncService.eliminarTarjeta(req.params.id, req.params.cardNo);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Utilidades (Proxy, Radar, Puerta)
app.get('/api/proxy-image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('Falta URL');
        const response = await syncService.client.fetch(imageUrl);
        if (!response.ok) throw new Error('Error descarga');
        const buffer = await response.arrayBuffer();
        res.set('Content-Type', 'image/jpeg');
        res.send(Buffer.from(buffer));
    } catch (e) { res.status(404).send(); }
});

app.get('/api/eventos/ultimo-local', (req, res) => {
    const evento = accessService.obtenerUltimoEvento();
    res.json(evento || {});
});

// Ruta para "Captura al Paso" (Radar)
app.get('/api/dispositivo/esperar-rostro', async (req, res) => {
    try {
        const evento = await syncService.esperarNuevoEvento();
        res.json(evento);
    } catch (e) { res.status(408).json({ error: e.message }); }
});

app.post('/api/dispositivo/abrir-puerta', async (req, res) => {
    try {
        await syncService.abrirPuerta();
        res.json({ success: true, message: 'Puerta abierta' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- CRON JOBS (Automatización) ---
cron.schedule('0 8,20 * * *', async () => {
    console.log('⏰ [CRON] Ejecutando sincronización automática...');
    try {
        const clientes = await syncService.obtenerClientes();
        await syncService.enviarClientes(clientes);
    } catch (e) { console.error('⏰ [CRON] Error:', e.message); }
});

// --- INICIO DEL SERVIDOR ---
const startServer = async () => {
  try {
    // Verificamos conexión a BD antes de abrir puerto
    await getConnection();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n==================================================`);
      console.log(`SERVIDOR UNIFICADO CORRIENDO EN PUERTO: ${PORT}`);
      console.log(`Interfaz Web: http://localhost:${PORT}`);
      console.log(`Uploads: ${UPLOADS_DIR}`);
      console.log(`Modo: ${process.env.LOCAL_IP || '?'} -> ${process.env.HIK_IP || '?'}`);
      console.log(`==================================================\n`);
    });

  } catch (error) {
    console.error('❌ Error fatal al iniciar:', error.message);
    process.exit(1);
  }
}

startServer();

