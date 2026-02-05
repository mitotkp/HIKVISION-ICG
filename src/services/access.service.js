import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURACIÓN DE RUTA PARA EL ARCHIVO PUENTE ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Guardaremos el registro en la carpeta uploads para que sea accesible por todos
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const EVENT_FILE = path.join(PROJECT_ROOT, 'uploads', 'ultimo_evento.json');

export class cAccessService {

    async processEvent(incomingData, file) {
        const info = incomingData.AccessControllerEvent || incomingData;

        // console.log('📨 Evento recibido:', info.majorEventType, info.subEventType); // Debug

        // Validar tipo de evento
        const eventType = info.subEventType || info.minorEventType || info.majorEventType;
        if (!eventType) return null;

        // Extraer datos clave
        const employeeId = info.employeeNoString || info.employeeNo || "DESCONOCIDO";
        const verifyMode = info.currentVerifyMode;
        const rawDoor = info.doorNo ?? info.door ?? info.stationID ?? 1;
        const puertaId = Number(rawDoor);
        const rawDate = info.dateTime || info.time || info.net_time;

        const cardNo = info.cardNo || null; 

        let fecha = new Date();
        if (rawDate) fecha = new Date(rawDate);

        // Construir el objeto del evento
        const accessLog = {
            empleadoId: employeeId,
            nombre: info.name || "Desconocido",
            fechaHora: fecha.toLocaleString(),
            puertaId: isNaN(puertaId) ? 1 : puertaId,
            codigoEvento: Number(eventType),
            descripcion: this._traducirEvento(Number(eventType), verifyMode),
            accesoPermitido: this._esAccesoExitoso(Number(eventType)),
            // URL de la foto (si vino alguna)
            tarjetaNumero: cardNo, 
            fotoUrl: file ? `/uploads/${file.filename}` : null
        };

        // --- AQUÍ ESTÁ EL TRUCO: GUARDAR EN DISCO 💾 ---
        // Escribimos los datos en un archivo JSON compartido
        try {
            const dataToSave = {
                ...accessLog,
                timestamp: Date.now() // Marca de tiempo actual
            };
            fs.writeFileSync(EVENT_FILE, JSON.stringify(dataToSave, null, 2));
        } catch (error) {
            console.error("Error guardando archivo puente:", error);
        }

        return accessLog;
    }

    // El servidor web leerá DEL DISCO, no de la memoria
    obtenerUltimoEvento() {
        try {
            if (fs.existsSync(EVENT_FILE)) {
                const data = fs.readFileSync(EVENT_FILE, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            // Si el archivo está siendo escrito justo ahora, puede fallar levemente
            return null;
        }
        return null;
    }

    _esAccesoExitoso(codigo) {
        return [1, 4, 197].includes(codigo);
    }

    _traducirEvento(codigo, verifyMode) {
        const diccionario = {
            1: 'ACCESO CONCEDIDO (Tarjeta válida)',
            9: 'DENEGADO (Tarjeta no válida)',
            75: 'ACCESO CONCEDIDO (Rostro)',
            76: 'DENEGADO (Rostro desconocido / Auth Fallida)',
            197: 'AUTENTICACIÓN FACIAL FALLIDA',
            23: 'AUTENTICACIÓN FALLIDA',
            112: 'CONECTADO EN EL PANEL',
            21: 'PUERTA ABIERTA',
            22: 'PUERTA CERRADA'
        };
        return diccionario[codigo] || `EVENTO ${codigo}`;
    }
}