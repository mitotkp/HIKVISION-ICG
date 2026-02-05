import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { cSyncService } from './services/sync.service.js';
import { cAccessService } from './services/access.service.js'; // Importación correcta

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

// Endpoint: Obtener Último Evento (Captura al Paso)
app.get('/api/eventos/ultimo-local', (req, res) => {
    const evento = accessService.obtenerUltimoEvento();
    res.json(evento || {});
});

app.listen(port, () => {
    console.log(`\n✅ Servidor Web LISTO en: http://localhost:${port}`);
    console.log(`📂 Carpeta de uploads: ${path.join(PROJECT_ROOT, 'uploads')}`);
});