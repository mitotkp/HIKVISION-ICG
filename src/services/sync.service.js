import { getConnection } from "../config/db.js";
import DigestFetch from "digest-fetch";
import FormData from "form-data";

const HIK_DEVICE = {
    ip: '10.10.10.185',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

export class cSyncService {

    constructor() {
        this.client = new DigestFetch(HIK_DEVICE.user, HIK_DEVICE.pass);
        this.baseUrl = `http://${HIK_DEVICE.ip}`;
    }

    // Helper para pausar y no saturar el CPU del dispositivo
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async obtenerClientes() {
        try {
            const pool = await getConnection();
            const result = await pool.request().query(`
                SELECT 
                    C.CODCLIENTE, 
                    C.NOMBRECLIENTE, 
                    CL.FECHAINIPLAN, 
                    CL.FECHAFINPLAN
                FROM 
                    CLIENTES C
                    INNER JOIN CLIENTESCAMPOSLIBRES CL ON C.CODCLIENTE = CL.CODCLIENTE
                ORDER BY C.CODCLIENTE
            `);
            return result.recordset;
        } catch (error) {
            console.error('Error SQL:', error.message);
            throw error;
        }
    }

    async enviarClientes(clientes) {
        console.log(`🚀 Sincronizando ${clientes.length} clientes (Modo JSON Nativo)...`);
        let exito = 0;
        let fallos = 0;

        // URL CONFIRMADA POR TU DOCUMENTACIÓN
        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/UserInfo/Record?format=json`;

        for (const [index, cliente] of clientes.entries()) {
            try {
                // Pausa de seguridad cada 10 registros para estabilidad
                if (index % 10 === 0) await this._sleep(200);

                const inicio = cliente.FECHAINIPLAN ? new Date(cliente.FECHAINIPLAN) : new Date("2024-01-01");
                const fin = cliente.FECHAFINPLAN ? new Date(cliente.FECHAFINPLAN) : new Date("2035-12-31");

                const idStr = String(cliente.CODCLIENTE).trim();
                const nameStr = String(cliente.NOMBRECLIENTE).trim().substring(0, 32) || "Cliente";

                // PAYLOAD CONSTRUIDO SEGÚN TUS CAPABILITIES
                const jsonPayload = {
                    UserInfo: {
                        employeeNo: idStr,
                        name: nameStr,
                        userType: "normal",

                        // VIGENCIA
                        Valid: {
                            enable: true,
                            beginTime: this._formatDate(inicio),
                            endTime: this._formatDate(fin),
                            timeType: "local"
                        },

                        // PERMISOS DE PUERTA
                        doorRight: "1",
                        RightPlan: [
                            {
                                doorNo: 1,
                                planTemplateNo: "1" // Plantilla 1 = Acceso 24h
                            }
                        ],

                        // LA JOYA DE LA CORONA: Prevenimos el error 75 aquí mismo
                        // Forzamos "Tarjeta O Rostro" desde el nacimiento del usuario
                        userVerifyMode: "cardOrFace"
                    }
                };

                // INTENTO DE CREACIÓN (POST)
                let response = await this.client.fetch(targetUrl, {
                    method: 'POST',
                    body: JSON.stringify(jsonPayload),
                    headers: { 'Content-Type': 'application/json' }
                });

                let data = await response.json();

                if (data.statusCode === 1 || data.statusString === 'OK') {
                    console.log(`✅ [${index + 1}] ${idStr} -> Creado Correctamente.`);
                    exito++;
                }
                // Si ya existe (duplicate), probamos ACTUALIZAR (PUT)
                else if (data.statusString && data.statusString.includes('duplicate')) {

                    // Nota: PUT también requiere ?format=json
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
                        console.error(`⚠️ [${idStr}] Falló actualización:`, data.subStatusCode || data.statusString);
                        fallos++;
                    }
                }
                else {
                    console.error(`❌ [${idStr}] Error:`, JSON.stringify(data));
                    fallos++;
                }

            } catch (error) {
                console.error(`Error Red [${cliente.CODCLIENTE}]:`, error.message);
                fallos++;
                await this._sleep(1000); // Pausa larga si hay error de red
            }
        }

        console.log(`\n--- RESUMEN FINAL ---`);
        console.log(`Total: ${clientes.length} | Éxitos: ${exito} | Fallos: ${fallos}`);
    }

    _formatDate(dateObj) {
        if (!dateObj || isNaN(dateObj)) return "2035-12-31T23:59:59";
        // Formato estricto ISO 8601 sin milisegundos: YYYY-MM-DDTHH:mm:ss
        const iso = dateObj.toISOString();
        return iso.split('.')[0];
    }

    async subirRostro(userId, imageBuffer) {
        console.log(`📸 Subiendo rostro para ID: ${userId}...`);

        // 1. Validar que tengamos datos
        if (!imageBuffer) throw new Error("El buffer de la imagen está vacío");

        const targetUrl = `${this.baseUrl}/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`;

        // 2. Preparar el Form-Data (Hikvision exige Multipart estricto para fotos)
        const form = new FormData();

        // Parte A: JSON Descriptor (Metadatos)
        const faceData = {
            FaceDataRecord: {
                faceLibType: "blackFD", // "blackFD" es la lista estándar de empleados
                FDID: "1",              // ID de la librería (siempre 1)
                FPID: String(userId)    // VITAL: Debe coincidir con el employeeNo del usuario
            }
        };
        form.append('FaceDataRecord', JSON.stringify(faceData));

        // Parte B: La Imagen en sí
        // Al venir de Multer (Web), es un Buffer. Debemos darle nombre y tipo.
        form.append('img', imageBuffer, {
            filename: 'rostro.jpg',
            contentType: 'image/jpeg',
            knownLength: imageBuffer.length
        });

        try {
            // 3. Enviar al dispositivo
            const response = await this.client.fetch(targetUrl, {
                method: 'POST', // Para subir fotos se usa POST
                body: form,
                headers: form.getHeaders() // form-data genera el Boundary automáticamente
            });

            const data = await response.json();

            // 4. Verificar respuesta
            if (data.statusCode === 1 || data.statusString === 'OK') {
                console.log(`✅ Foto vinculada correctamente al usuario ${userId}`);
                return { success: true };
            } else {
                console.error(`❌ Hikvision rechazó la foto:`, data);
                throw new Error(data.subStatusCode || data.statusString || "Error desconocido al subir foto");
            }
        } catch (error) {
            console.error('Error de red al subir foto:', error.message);
            throw error;
        }
    }

    /**
     * Asigna una tarjeta RFID a un usuario.
     * Endpoint: /ISAPI/AccessControl/CardInfo/Record
     */
    async vincularTarjeta(userId, cardNumber) {
        console.log(`💳 Vinculando tarjeta ${cardNumber} al ID: ${userId}...`);

        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Record?format=json`;

        // Estructura JSON para vincular tarjeta
        const body = {
            CardInfo: {
                employeeNo: String(userId),
                cardNo: String(cardNumber),
                cardType: "normalCard"
            }
        };

        try {
            const response = await this.client.fetch(targetUrl, {
                method: 'POST', // Usamos POST para crear el registro de tarjeta
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (data.statusCode === 1 || data.statusString === 'OK') {
                console.log(`✅ Tarjeta ${cardNumber} vinculada al usuario ${userId}`);
                return { success: true };
            } else {
                console.error(`❌ Hikvision rechazó la tarjeta:`, data);
                throw new Error(data.subStatusCode || data.statusString || "Error al vincular tarjeta");
            }
        } catch (error) {
            console.error('Error de red al vincular tarjeta:', error.message);
            throw error;
        }
    }

    /**
     * Obtiene las tarjetas siguiendo el diagrama oficial:
     * 1. Search (POST) con Paginación obligatoria.
     * Endpoint: /ISAPI/AccessControl/CardInfo/Search?format=json
     */
    async obtenerTarjetasDelDispositivo(userId) {
        console.log(`📡 Buscando tarjetas para ID: ${userId}...`);

        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Search?format=json`;

        // PAYLOAD ESTRICTO SEGÚN DOCUMENTACIÓN
        const body = {
            CardInfoSearchCond: {
                searchID: "BusquedaWeb-" + Date.now(), // ID único para esta búsqueda
                searchResultPosition: 0, // <--- ESTO FALTABA: Obligatorio empezar en 0
                maxResults: 10,          // Traemos máx 10
                EmployeeNoList: [
                    { employeeNo: String(userId) }
                ]
            }
        };

        try {
            const response = await this.client.fetch(targetUrl, {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            // CASO A: Respuesta exitosa con tarjetas
            if (data.CardInfoSearch && data.CardInfoSearch.CardInfo) {
                // Hikvision devuelve un Objeto si es 1 sola tarjeta, y Array si son varias.
                // Normalizamos siempre a Array.
                const listaBruta = Array.isArray(data.CardInfoSearch.CardInfo)
                    ? data.CardInfoSearch.CardInfo
                    : [data.CardInfoSearch.CardInfo];

                // Extraemos solo el número de tarjeta (cardNo)
                const tarjetas = listaBruta.map(t => t.cardNo);
                console.log(`   ✅ Encontradas ${tarjetas.length} tarjetas.`);
                return tarjetas;
            }

            // CASO B: Respuesta exitosa pero SIN tarjetas (responseStatusStrg: "NO MATCH" o lista vacía)
            if (data.CardInfoSearch && data.CardInfoSearch.responseStatusStrg === "NO MATCH") {
                console.log(`   ℹ️ El usuario no tiene tarjetas asignadas.`);
                return [];
            }

            // CASO C: Error genérico
            if (data.statusCode && data.statusCode !== 1) {
                console.warn(`   ⚠️ Alerta Hikvision: ${data.statusString}`);
            }

            return [];

        } catch (error) {
            console.error('Error buscando tarjetas:', error.message);
            return [];
        }
    }

    /**
     * Busca historial con rango de fecha AMPLIO para evitar errores de reloj.
     */
    async obtenerUltimosEventos() {
        // console.log("🔍 Consultando historial de eventos..."); // Debug opcional
        const url = `${this.baseUrl}/ISAPI/AccessControl/AcsEvent/Search?format=json`;

        const payload = {
            AcsEventSearchDescription: {
                searchID: "Search_" + Date.now(), // ID único cada vez
                searchResultPosition: 0,
                maxResults: 30, // Traemos bastantes para asegurar
                major: 0,
                minor: 0,
                // TRUCO: Rango de fecha exagerado para ignorar desincronización de hora
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

            // Filtramos, ordenamos y limpiamos
            return lista
                .filter(e => e.pictureURL) // Solo los que tienen foto
                .map(e => ({
                    time: e.time,
                    minor: parseInt(e.minor, 10), // <--- IMPORTANTE: Convertir a número
                    pictureURL: e.pictureURL,
                    name: e.name || "Desconocido"
                }))
                .sort((a, b) => new Date(b.time) - new Date(a.time)); // El más nuevo primero (índice 0)

        } catch (error) {
            console.error("Error buscando eventos:", error.message);
            return [];
        }
    }

    /**
     * Método Radar: Busca el primer evento 76 (Desconocido) que aparezca.
     */
    async esperarNuevoEvento() {
        console.log("📡 Radar activado: Esperando evento 76 (Desconocido)...");

        // 1. Guardamos la hora del evento 76 más reciente que existe AHORA (para no repetir)
        let ultimaHoraEvento76 = "";
        try {
            const historial = await this.obtenerUltimosEventos();
            const ultimo76 = historial.find(e => e.minor === 76);
            if (ultimo76) {
                ultimaHoraEvento76 = ultimo76.time;
                console.log(`   (Ignorando eventos anteriores a: ${ultimaHoraEvento76})`);
            }
        } catch (e) { }

        const intentos = 20; // 20 intentos de 1.5s = 30 segundos aprox

        for (let i = 0; i < intentos; i++) {
            await this._sleep(1500); // Espera 1.5 seg entre consultas

            try {
                // 2. Buscamos de nuevo
                const eventos = await this.obtenerUltimosEventos();

                // 3. Filtramos: Solo código 76
                const eventoCandidato = eventos.find(e => e.minor === 76);

                if (eventoCandidato) {
                    // Verificamos si es NUEVO (hora distinta a la que vimos al inicio)
                    // O si no había ninguno antes, este es el bueno.
                    if (eventoCandidato.time !== ultimaHoraEvento76) {
                        console.log(`📸 ¡CAPTURA EXITOSA! Evento 76 detectado a las ${eventoCandidato.time}`);
                        console.log(`   URL: ${eventoCandidato.pictureURL}`);
                        return eventoCandidato;
                    }
                }
            } catch (e) {
                process.stdout.write("x"); // Error de red momentáneo
            }
        }

        throw new Error("Tiempo agotado. No se detectó un nuevo rostro desconocido.");
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /**
     * Elimina una tarjeta específica.
     * Endpoint: PUT /ISAPI/AccessControl/CardInfo/Delete
     */
    async eliminarTarjeta(userId, cardNo) {
        console.log(`🗑️ Eliminando tarjeta ${cardNo}...`);

        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/CardInfo/Delete?format=json`;

        // CORRECCIÓN: Enviamos SOLO la lista de tarjetas.
        // Quitamos EmployeeNoList para evitar "Invalid Content".
        const body = {
            CardInfoDelCond: {
                CardNoList: [
                    { cardNo: String(cardNo) }
                ]
            }
        };

        try {
            const response = await this.client.fetch(targetUrl, {
                method: 'PUT',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            // Validamos éxito (statusCode 1 o 'OK')
            if (data.statusCode === 1 || data.statusString === 'OK') {
                console.log(`   ✅ Tarjeta ${cardNo} eliminada.`);
                return { success: true };
            } else {
                console.error(`   ❌ Fallo al eliminar:`, data);
                throw new Error(data.subStatusCode || data.statusString || "Error desconocido");
            }
        } catch (error) {
            console.error('Error borrando tarjeta:', error.message);
            throw error;
        }
    }
}