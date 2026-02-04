import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { cSyncService } from './services/sync.service.js';
import { cAccessService } from './services/access.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 6065;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const syncService = new cSyncService();
const accessService = new cAccessService();

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(path.join(__dirname, '../uploads')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/clientes', async (req, res) => {
    try {
        const clientes = await syncService.obtenerClientes();
        res.json(clientes);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('api/sync-all', async (req, res) => {
    try {
        const clientes = await syncService.obtenerClientes();
        syncService.enviarClientes(clientes).then(() => {
            console.log('Sincronizar masiva terminada')
        })

        res.json({ message: 'Sincronización iniciada en segundo plano ' })

    } catch (error) {
        res.status(500).json({ error: error.message })
    }
});

app.post('/api/cliente/:id/foto', upload.single('foto'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Falta la imagen' });

        await syncService.subirRostro(req.params.id, req.file.buffer);
        res.json({ success: true, message: 'Foto actualizada correctamente' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cliente/:id/tarjeta', async (req, res) => {
    try {
        const { tarjeta } = req.body;
        await syncService.vincularTarjeta(req.params.id, tarjeta);
        res.json({ success: true, message: 'Tarjeta vinculada correctamente' });
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

app.get('/api/eventos/ultimo-local', (req, res) => {
    const evento = accessService.obtenerUltimoEvento();
    res.json(evento || {});
});

app.delete('/api/cliente/:id/tarjeta/:cardNo', async (req, res) => {
    try {
        await syncService.eliminarTarjeta(req.params.id, req.params.cardNo);
        res.json({ success: true, message: 'Tarjeta eliminada' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Servidor Web listo en http://localhost:${port}`);
    console.log(`Carpeta uploads servida en: ${path.join(__dirname, '../uploads')}`);
});