import { getConnection } from "../config/db.js";
import DigestFetch from "digest-fetch";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURACIÓN DE RUTAS ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Calculamos la raíz del proyecto
const PROJECT_ROOT = path.resolve(__dirname, '../../');
const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');

// Aseguramos que la carpeta uploads exista
if (!fs.existsSync(UPLOADS_DIR)) {
    try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) { }
}

export class cSyncService {

    constructor() {
        // -----------------------------------------------------------
        // 1. CONFIGURACIÓN DEL DISPOSITIVO (DESTINO)
        // -----------------------------------------------------------
        this.config = {
            ip: '192.168.1.64', // <--- IP DE LA CÁMARA
            user: 'admin',
            pass: 'R3d3s1pc4..'
        };
        this.baseUrl = `http://${this.config.ip}`;
        this.client = new DigestFetch(this.config.user, this.config.pass);
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    _formatDate(d) { return (!d || isNaN(d)) ? "2035-12-31T23:59:59" : d.toISOString().split('.')[0]; }

    // --- 1. SUBIR ROSTRO (MÉTODO URL / "DOWNLOAD") ---
    // Este método evita el error 'badJsonFormat' porque no envía archivos binarios,
    // sino que le dice a la cámara: "Descárgalo tú misma de esta URL".

    async subirRostro(userId, imageBuffer) {
        console.log(`📸 Procesando foto para ID: ${userId}...`);

        if (!imageBuffer) throw new Error("Buffer de imagen vacío");

        // A) Guardar la foto temporalmente
        const fileName = `rostro_${userId}_${Date.now()}.jpg`;
        const localPath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(localPath, imageBuffer);

        // B) Configurar URL
        const MI_IP_PC = '192.168.1.10'; // <--- TU IP DE PC
        const PUERTO_WEB = 6065;
        const publicFaceUrl = `http://${MI_IP_PC}:${PUERTO_WEB}/uploads/${fileName}`;
        
        console.log(`   🔗 Link generado: ${publicFaceUrl}`);

        const targetUrl = `${this.baseUrl}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`;
        
        const payload = {
            faceURL: publicFaceUrl,
            faceLibType: "blackFD",
            FDID: "1",
            FPID: String(userId),
            featurePointType: "face"
        };

        // --- LÓGICA DE REINTENTO (LA SOLUCIÓN AL FALLO INICIAL) ---
        const MAX_INTENTOS = 2;
        let ultimoError = null;

        for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
            try {
                if (intento > 1) console.log(`   ⚠️ Reintentando subida (Intento ${intento})...`);

                const response = await this.client.fetch(targetUrl, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' }
                });

                const textResponse = await response.text();
                let data = {};
                try { data = JSON.parse(textResponse); } catch (e) {}

                // Verificar éxito
                if (data.statusCode === 1 || data.statusString === 'OK' || textResponse.includes('"statusCode": 1')) {
                    
                    // Limpieza exitosa
                    setTimeout(() => {
                        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
                    }, 15000);

                    console.log(`   ✅ ¡ÉXITO! Foto asignada correctamente.`);
                    return { success: true };
                } else {
                    // Si el dispositivo responde con error, lanzamos excepción para que el catch lo agarre (o no, dependiendo del error)
                    // Pero si es error de "Descarga", reintentar suele arreglarlo
                    throw new Error(data.subStatusCode || data.statusString || textResponse);
                }

            } catch (error) {
                console.error(`   ❌ Fallo intento ${intento}: ${error.message}`);
                ultimoError = error;
                
                // Si falló, esperamos 1 segundo antes de reintentar para dar tiempo a la conexión
                if (intento < MAX_INTENTOS) await this._sleep(1000);
            }
        }

        // Si llegamos aquí, fallaron todos los intentos
        // Borramos el archivo temporal para no dejar basura
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
        
        throw ultimoError || new Error("No se pudo subir la foto tras varios intentos.");
    }

    // --- NUEVO MÉTODO: ELIMINAR ROSTRO ---
    async eliminarRostro(userId) {
        console.log(`🗑️ Eliminando foto del usuario ${userId}...`);

        // Para borrar, actualizamos el registro (PUT) con una URL vacía
        const targetUrl = `${this.baseUrl}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`;
        
        const payload = {
            faceURL: "", // <--- URL Vacía = Borrar Foto
            faceLibType: "blackFD",
            FDID: "1",
            FPID: String(userId)
        };

        try {
            const response = await this.client.fetch(targetUrl, {
                method: 'PUT', // PUT para actualizar
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });

            const text = await response.text();
            let data = {};
            try { data = JSON.parse(text); } catch (e) {}

            if (data.statusCode === 1 || data.statusString === 'OK' || text.includes('OK')) {
                console.log(`   ✅ ¡Foto eliminada!`);
                return { success: true };
            } else {
                throw new Error(data.subStatusCode || "No se pudo eliminar la foto");
            }
        } catch (error) {
            console.error('Error borrando foto:', error.message);
            throw error;
        }
    }

    // --- 2. OBTENER CLIENTES (SQL SERVER) ---
    async obtenerClientes() {
        try {
            const pool = await getConnection();
            const result = await pool.request().query(`
                SELECT C.CODCLIENTE, C.NOMBRECLIENTE, CL.FECHAINIPLAN, CL.FECHAFINPLAN
                FROM CLIENTES C INNER JOIN CLIENTESCAMPOSLIBRES CL ON C.CODCLIENTE = CL.CODCLIENTE
                ORDER BY C.CODCLIENTE
            `);
            return result.recordset;
        } catch (error) {
            console.error('Error SQL:', error.message);
            throw error;
        }
    }

    // --- 3. ENVIAR CLIENTES MASIVO ---
    async enviarClientes(clientes) {
        console.log(`🚀 Sincronizando ${clientes.length} clientes...`);
        let exito = 0; let fallos = 0;
        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/UserInfo/Record?format=json`;

        for (const [index, cliente] of clientes.entries()) {
            try {
                if (index % 10 === 0) await this._sleep(100);

                const inicio = cliente.FECHAINIPLAN ? new Date(cliente.FECHAINIPLAN) : new Date("2024-01-01");
                const fin = cliente.FECHAFINPLAN ? new Date(cliente.FECHAFINPLAN) : new Date("2035-12-31");
                const idStr = String(cliente.CODCLIENTE).trim();
                const nameStr = String(cliente.NOMBRECLIENTE).trim().substring(0, 32) || "Cliente";

                const jsonPayload = {
                    UserInfo: {
                        employeeNo: idStr,
                        name: nameStr,
                        userType: "normal",
                        Valid: {
                            enable: true,
                            beginTime: this._formatDate(inicio),
                            endTime: this._formatDate(fin),
                            timeType: "local"
                        },
                        doorRight: "1",
                        RightPlan: [{ doorNo: 1, planTemplateNo: "1" }],
                        userVerifyMode: "cardOrFace"
                    }
                };

                let response = await this.client.fetch(targetUrl, {
                    method: 'POST',
                    body: JSON.stringify(jsonPayload),
                    headers: { 'Content-Type': 'application/json' }
                });
                let data = await response.json();

                if (data.statusCode === 1 || data.statusString === 'OK') {
                    console.log(`✅ [${index + 1}] ${idStr} -> OK.`);
                    exito++;
                } else if (data.statusString && data.statusString.includes('duplicate')) {
                    // Si existe, actualizamos (PUT)
                    response = await this.client.fetch(targetUrl, {
                        method: 'PUT',
                        body: JSON.stringify(jsonPayload),
                        headers: { 'Content-Type': 'application/json' }
                    });
                    data = await response.json();
                    if (data.statusCode === 1 || data.statusString === 'OK') {
                        console.log(`🔄 [${index + 1}] ${idStr} -> Actualizado.`);
                        exito++;
                    } else {
                        console.error(`⚠️ [${idStr}] Falló Update:`, data.subStatusCode);
                        fallos++;
                    }
                } else {
                    console.error(`❌ [${idStr}] Error:`, data.statusString);
                    fallos++;
                }
            } catch (error) {
                console.error(`Error Red [${cliente.CODCLIENTE}]:`, error.message);
                fallos++;
                await this._sleep(1000);
            }
        }
        console.log(`\n--- RESUMEN: ${exito} OK | ${fallos} Fallos ---`);
    }

    // --- 4. VINCULAR TARJETA ---
    async vincularTarjeta(userId, cardNumber) {
        console.log(`💳 Vinculando tarjeta ${cardNumber} a ID ${userId}...`);
        const url = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Record?format=json`;
        const body = {
            CardInfo: {
                employeeNo: String(userId),
                cardNo: String(cardNumber),
                cardType: "normalCard"
            }
        };

        const res = await this.client.fetch(url, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.statusCode === 1 || data.statusString === 'OK') return { success: true };
        throw new Error(data.subStatusCode || "Error al vincular tarjeta");
    }

    // --- 5. OBTENER TARJETAS ---
    async obtenerTarjetasDelDispositivo(userId) {
        const url = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Search?format=json`;
        const body = {
            CardInfoSearchCond: {
                searchID: "SearchCard" + Date.now(),
                searchResultPosition: 0,
                maxResults: 10,
                EmployeeNoList: [{ employeeNo: String(userId) }]
            }
        };

        try {
            const res = await this.client.fetch(url, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();

            if (data.CardInfoSearch && data.CardInfoSearch.CardInfo) {
                const lista = Array.isArray(data.CardInfoSearch.CardInfo) ? data.CardInfoSearch.CardInfo : [data.CardInfoSearch.CardInfo];
                return lista.map(t => t.cardNo);
            }
            return [];
        } catch (e) { return []; }
    }

    // --- 6. ELIMINAR TARJETA ---
    async eliminarTarjeta(userId, cardNo) {
        console.log(`🗑️ Eliminando tarjeta ${cardNo}...`);
        const url = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Delete?format=json`;
        const body = {
            CardInfoDelCond: { CardNoList: [{ cardNo: String(cardNo) }] }
        };
        const res = await this.client.fetch(url, {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.statusCode === 1 || data.statusString === 'OK') return { success: true };
        throw new Error(data.subStatusCode || "Error al eliminar");
    }

    // --- 7. CAPTURA AL PASO (RADAR DE EVENTOS) ---
    async obtenerUltimosEventos() {
        const url = `${this.baseUrl}/ISAPI/AccessControl/AcsEvent/Search?format=json`;
        const payload = {
            AcsEventSearchDescription: {
                searchID: "Radar_" + Date.now(),
                searchResultPosition: 0,
                maxResults: 30,
                major: 0, minor: 0,
                startTime: "2020-01-01T00:00:00-05:00",
                endTime: "2030-12-31T23:59:59-05:00"
            }
        };
        try {
            const res = await this.client.fetch(url, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });
            if (!res.ok) return [];
            const data = await res.json();
            const eventos = data.AcsEventSearch?.AcsEvent || [];
            const lista = Array.isArray(eventos) ? eventos : [eventos];

            return lista
                .filter(e => e.pictureURL)
                .map(e => ({
                    time: e.time,
                    minor: parseInt(e.minor, 10),
                    pictureURL: e.pictureURL,
                    name: e.name || "Desconocido"
                }))
                .sort((a, b) => new Date(b.time) - new Date(a.time));
        } catch (e) { return []; }
    }

    /**
     * Método Radar Mejorado: 
     * Detecta CUALQUIER rostro (Conocido o Desconocido) que aparezca frente a la cámara.
     */
    async esperarNuevoEvento() {
        console.log("📡 Radar activado: Escaneando cualquier rostro reciente...");
        
        let ultimaURL = "";
        
        // 1. Memorizamos la foto más reciente que tenga la cámara AHORA
        try {
            const historial = await this.obtenerUltimosEventos();
            if (historial.length > 0) {
                ultimaURL = historial[0].pictureURL;
            }
        } catch (e) {}

        const intentos = 20; // 30 segundos aprox.

        for (let i = 0; i < intentos; i++) {
            await this._sleep(1500);

            try {
                // 2. Consultamos los eventos
                const eventos = await this.obtenerUltimosEventos();
                
                if (eventos.length > 0) {
                    const masReciente = eventos[0]; // El primero es el más nuevo

                    // 3. COMPARACIÓN:
                    // Si la foto es distinta a la que vimos al inicio... ¡Es alguien nuevo!
                    // (No importa si es ID 3, Desconocido, o ID 50)
                    if (masReciente.pictureURL !== ultimaURL) {
                        console.log(`📸 ¡CAPTURA EXITOSA! Rostro detectado: ${masReciente.name} a las ${masReciente.time}`);
                        return masReciente;
                    }
                }
            } catch (e) {
                process.stdout.write("."); // Feedback visual simple
            }
        }
        
        throw new Error("Tiempo agotado. Nadie pasó frente a la cámara.");
    }
}