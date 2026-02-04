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
     * Espera a que aparezca un evento de "Rostro Desconocido" (Código 76)
     * que sea DIFERENTE a la última foto registrada.
     */
    async esperarNuevoEvento() {
        console.log("⏳ Buscando rostro desconocido (Code 76)...");

        // 1. Memorizamos la última foto de un desconocido (para saber si cambia)
        let ultimaFotoConocida = null;
        try {
            const historial = await this.obtenerUltimosEventos();
            // Filtramos solo los eventos 76 (Desconocidos)
            const desconocidos = historial.filter(e => e.minor === 76);
            if (desconocidos.length > 0) {
                ultimaFotoConocida = desconocidos[0].pictureURL;
            }
        } catch (e) { }

        const intentosMaximos = 20; // 40 segundos de espera

        for (let i = 0; i < intentosMaximos; i++) {
            // Esperamos 2 segundos
            await new Promise(r => setTimeout(r, 2000));

            try {
                // 2. Buscamos eventos recientes
                const eventos = await this.obtenerUltimosEventos();

                // 3. FILTRO MAESTRO: Solo nos interesa el código 76
                const eventosDesconocidos = eventos.filter(e => e.minor === 76);

                if (eventosDesconocidos.length > 0) {
                    const eventoCandidato = eventosDesconocidos[0]; // El más nuevo

                    // 4. COMPARACIÓN: ¿Es una foto nueva?
                    // Si no teníamos referencia anterior, asumimos que este es el nuevo
                    // Si teníamos referencia, validamos que la URL sea distinta
                    if (eventoCandidato.pictureURL !== ultimaFotoConocida) {
                        console.log(`📸 ¡Captura exitosa! Rostro desconocido detectado: ${eventoCandidato.time}`);
                        return eventoCandidato;
                    }
                }
            } catch (e) {
                console.warn(`   Intento ${i + 1}:`, e.message);
            }
        }

        throw new Error("Tiempo agotado. No se detectó ningún rostro desconocido nuevo.");
    }

    /**
     * Busca los últimos eventos de acceso (fichajes) del día que tengan foto.
     * Endpoint: POST /ISAPI/AccessControl/AcsEvent/Search
     */
    async obtenerUltimosEventos() {
        console.log("🔍 Buscando historial de eventos con foto...");
        const targetUrl = `${this.baseUrl}/ISAPI/AccessControl/AcsEvent/Search?format=json`;

        // 1. Calcular rango de tiempo (Desde las 00:00 de hoy hasta mañana)
        const hoy = new Date();
        const inicio = new Date(hoy.setHours(0, 0, 0, 0)).toISOString().split('.')[0] + "-05:00"; // Ajusta tu zona horaria si es necesario
        const fin = new Date(hoy.setHours(23, 59, 59, 999)).toISOString().split('.')[0] + "-05:00";

        const payload = {
            AcsEventSearchDescription: {
                searchID: "HistorialWeb_" + Date.now(), // ID único para evitar caché
                searchResultPosition: 0,
                maxResults: 30, // Traemos los últimos 30
                major: 0,       // 0 = Todos los tipos principales
                minor: 0,       // 0 = Todos los subtipos (75=Pass, 76=Mismatch, etc)
                startTime: inicio,
                endTime: fin
            }
        };

        try {
            const response = await this.client.fetch(targetUrl, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                // Si no hay eventos, Hikvision a veces devuelve error o 'NO MATCH'
                if (response.status === 400 || response.status === 404) return [];
                throw new Error(`Error buscando eventos: ${response.status}`);
            }

            const data = await response.json();

            // 2. Extraer lista de eventos (puede venir como objeto único o array)
            const searchResult = data.AcsEventSearch || {};
            const eventosRaw = searchResult.AcsEvent || [];
            const listaEventos = Array.isArray(eventosRaw) ? eventosRaw : [eventosRaw];

            // 3. Filtrar y limpiar datos
            // Solo nos interesan los eventos que tengan URL de foto (pictureURL)
            return listaEventos
                .filter(e => e.pictureURL && e.pictureURL.length > 0)
                .map(e => ({
                    time: e.time,
                    // Parseamos 'minor' a entero para poder filtrar por 76 (Desconocido) después
                    minor: parseInt(e.minor, 10),
                    pictureURL: e.pictureURL,
                    name: e.name || "Desconocido",
                    cardNo: e.cardNo
                }))
                .reverse(); // Invertimos para que el más reciente quede primero (índice 0)

        } catch (error) {
            console.error("Error en obtenerUltimosEventos:", error.message);
            // Retornamos array vacío para no romper el frontend
            return [];
        }
    }

    // Helper interno para buscar eventos desde una fecha específica
    async _buscarEventosDesde(fechaInicioISO) {
        const url = `${this.baseUrl}/ISAPI/AccessControl/AcsEvent/Search?format=json`;
        const hoy = new Date();
        const fin = new Date(hoy.setHours(23, 59, 59, 999)).toISOString().split('.')[0] + "-05:00";

        const payload = {
            AcsEventSearchDescription: {
                searchID: "CapturaVivo" + Date.now(), // ID único
                searchResultPosition: 0,
                maxResults: 5,
                major: 0, minor: 0,
                startTime: fechaInicioISO, // <--- CLAVE: Solo eventos desde que dimos click
                endTime: fin
            }
        };

        const res = await this.client.fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();
        const eventos = data.AcsEventSearch?.AcsEvent || [];
        const lista = Array.isArray(eventos) ? eventos : [eventos];

        // Filtramos solo los que tienen foto válida
        return lista.filter(e => e.pictureURL).map(e => ({
            time: e.time,
            pictureURL: e.pictureURL
        })).reverse();
    }

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