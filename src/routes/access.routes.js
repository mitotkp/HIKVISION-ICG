import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { cAccessController } from '../controllers/access.controller.js';

const router = Router();
const controller = new cAccessController();

const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `access-${Date.now()}${ext}`);
    }
});

const upload = multer({ storage });

// --- Definición de Rutas ---
// POST /api/hikvision/event
// Usamos .bind(controller) para no perder el contexto 'this'
router.post('/event', upload.any(), controller.receiveEvent.bind(controller));

export default router;