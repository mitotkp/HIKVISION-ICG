import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { cSyncService } from './services/sync.service.js';

const app = express();
const port = 6065;
const syncService = new cSyncService();

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// ...
// 10. NUEVO: Endpoint de "Captura en Vivo" (Espera activa)
app.get('/api/dispositivo/esperar-rostro', async (req, res) => {
    try {
        // Esto mantendrá la petición abierta hasta 30 segundos
        const evento = await syncService.esperarNuevoEvento();
        res.json(evento);
    } catch (error) {
        // Si nadie pasó en 30s, devolvemos 408 (Timeout)
        res.status(408).json({ error: error.message });
    }
});
// ...

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
});