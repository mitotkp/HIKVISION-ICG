import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { cSyncService } from './services/sync.service.js';
import { cAccessService } from './services/access.service.js'; // Importación correcta
import cron from 'node-cron';

// Configuración de rutas
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Definimos la raíz del proyecto (subimos un nivel desde 'src')
const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

const app = express();
const port = 6065;

app.use(cors());
app.use(express.json());

// 1. Servir Frontend
app.use(express.static(path.join(__dirname, 'public')));

// 2. Servir Imágenes (Corrección de ruta absoluta)
// Esto asegura que /uploads/foto.jpg apunte a la carpeta correcta en la raíz
app.use('/uploads', express.static(UPLOADS_DIR));

// Instancias
const syncService = new cSyncService();
const accessService = new cAccessService();

// Configuración de Multer (Temporal para subida manual)
const upload = multer({ storage: multer.memoryStorage() });

// --- RUTAS API ---

app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await syncService.obtenerClientes();
        res.json(clientes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sync-all', async (req, res) => {
    try {
        const clientes = await syncService.obtenerClientes();
        syncService.enviarClientes(clientes).then(() => console.log('Sync Masiva OK'));
        res.json({ message: 'Sincronización iniciada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sync-stream', async (req, res) => {
    // Cabeceras para Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const clientes = await syncService.obtenerClientes();
        
        // Enviamos mensaje inicial
        res.write(`data: ${JSON.stringify({ tipo: 'inicio', total: clientes.length })}\n\n`);

        await syncService.enviarClientes(clientes, (progreso) => {
            // Cada vez que syncService avanza, enviamos un evento al navegador
            const payload = JSON.stringify({ 
                tipo: 'progreso', 
                actual: progreso.actual, 
                total: progreso.total,
                nombre: progreso.nombre
            });
            res.write(`data: ${payload}\n\n`);
        });

        // Mensaje final
        res.write(`data: ${JSON.stringify({ tipo: 'fin' })}\n\n`);
        res.end();

    } catch (error) {
        res.write(`data: ${JSON.stringify({ tipo: 'error', msg: error.message })}\n\n`);
        res.end();
    }
});

// Endpoint: Subir Foto Manualmente
app.post('/api/cliente/:id/foto', upload.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });

        // Llamada al servicio de sincronización con el dispositivo
        await syncService.subirRostro(req.params.id, req.file.buffer);
        res.json({ success: true, message: 'Foto actualizada' });
    } catch (error) {
        console.error("Error subiendo foto:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint: Vincular Tarjeta
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

// --- RUTA FALTANTE PARA CAPTURA AL PASO (RADAR) ---
app.get('/api/dispositivo/esperar-rostro', async (req, res) => {
    try {
        // Llamamos al método Radar que acabamos de corregir
        const evento = await syncService.esperarNuevoEvento();
        
        // Enviamos la URL de la foto al frontend
        res.json({
            pictureURL: evento.pictureURL,
            time: evento.time,
            name: evento.name
        });
    } catch (e) {
        // Si se acaba el tiempo (30s), enviamos error 408 (Timeout)
        res.status(408).json({ error: e.message });
    }
});

// Proxy de imagen (Para poder ver las fotos del dispositivo en la web sin problemas de CORS)
app.get('/api/proxy-image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('Falta URL');

        // Descargamos la imagen del dispositivo
        const response = await syncService.client.fetch(imageUrl);
        if (!response.ok) throw new Error('No se pudo descargar imagen');

        const buffer = await response.arrayBuffer();
        res.set('Content-Type', 'image/jpeg');
        res.send(Buffer.from(buffer));
    } catch (e) {
        res.status(500).send('Error proxy');
    }
});

// --- NUEVA RUTA: CONSULTAR SI EL CLIENTE TIENE FOTO ---
app.get('/api/cliente/:id/foto', async (req, res) => {
    try {
        const userId = req.params.id;
        // Consultamos directamente al dispositivo
        const resultado = await syncService.verificarRostro(userId);
        
        res.json({ 
            hasPhoto: resultado.hasFace,
            // Si el dispositivo devolviera una URL válida, la pasaríamos.
            // Si no, enviamos null y el frontend pondrá un placeholder.
            photoUrl: resultado.faceUrl 
        });

    } catch (e) { 
        console.error("Error API Foto:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// --- NUEVA RUTA: BORRAR FOTO ---
app.delete('/api/cliente/:id/foto', async (req, res) => {
    try {
        await syncService.eliminarRostro(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Endpoint: Obtener Último Evento (Captura al Paso)
app.get('/api/eventos/ultimo-local', (req, res) => {
    const evento = accessService.obtenerUltimoEvento();
    res.json(evento || {});
});

// --- PROXY DE IMÁGENES HIKVISION (NUEVO) ---
app.get('/api/proxy-image', async (req, res) => {
    try {
        const imageUrl = req.query.url;
        if (!imageUrl) return res.status(400).send('Falta URL');

        // Usamos el cliente con credenciales del servicio de sincronización
        const response = await syncService.client.fetch(imageUrl);
        
        if (!response.ok) throw new Error(`Error descargando imagen: ${response.statusText}`);

        // Convertimos a Buffer y enviamos al navegador como imagen normal
        const buffer = await response.arrayBuffer();
        res.set('Content-Type', 'image/jpeg');
        res.send(Buffer.from(buffer));

    } catch (e) {
        console.error("Error en proxy de imagen:", e.message);
        // Enviamos una imagen vacía o error para no romper la UI
        res.status(500).send("Error cargando imagen");
    }
});

// --- RUTA: ABRIR PUERTA MANUALMENTE ---
app.post('/api/dispositivo/abrir-puerta', async (req, res) => {
    try {
        await syncService.abrirPuerta(); // Por defecto abre la puerta 1
        res.json({ success: true, message: 'Puerta abierta' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

cron.schedule('0 8,20 * * *', async() => {
    console.log('[CRON] Iniciando sincronización automática programada...');
    try {
        const clientes = await syncService.obtenerClientes();
        const resultado = await syncService.enviarClientes(clientes);
        console.log(` [CRON] Finalizado. Éxitos: ${resultado.exito}, Fallos: ${resultado.fallos}`);
    } catch (e) {
        console.error('[CRON] Error:', e.message);
    }
}); 

app.listen(port, () => {
    console.log(`\n Servidor Web LISTO en: http://localhost:${port}`);
    console.log(` Carpeta de uploads: ${path.join(PROJECT_ROOT, 'uploads')}`);
});