import { timeStamp } from "console";

let ultimoEventoRecibido = null;

export class cAccessService {

    async processEvent(incomingData, file) {
        const info = incomingData.AccessControllerEvent || incomingData;

        console.log('CAMPOS RECIBIDOS DEL HIKVISION:', Object.keys(info));

        const eventType = info.subEventType || info.minorEventType || info.majorEventType;

        console.log(info.majorEventType, info.subEventType, info.minorEventType)

        if (!eventType) return null;

        const employeeId = info.employeeNoString || info.employeeNo || "DESCONOCIDO";
        const verifyMode = info.currentVerifyMode;

        const rawDoor = info.doorNo ?? info.door ?? info.stationID ?? 1;
        const puertaId = Number(rawDoor);

        const rawDate = info.dateTime || info.time || info.net_time;

        let fecha = new Date();
        if (rawDate) {
            fecha = new Date(rawDate);
        }

        const accessLog = {
            empleadoId: employeeId,
            nombre: info.name || "Desconocido",

            fechaHora: fecha.toLocaleString(),

            puertaId: isNaN(puertaId) ? 1 : puertaId,

            codigoEvento: Number(eventType),
            descripcion: this._traducirEvento(Number(eventType), verifyMode),
            accesoPermitido: this._esAccesoExitoso(Number(eventType)),

            fotoUrl: file ? `/uploads/${file.filename}` : null
        };

        ultimoEventoRecibido = {
            ...accessLog,
            timestamp: Date.now()
        };

        return accessLog;
    }

    obtenerUltimoEvento() {
        return ultimoEventoRecibido;
    }

    _esAccesoExitoso(codigo) {
        return [1, 4, 197].includes(codigo);
    }

    _traducirEvento(codigo, verifyMode) {
        //if (verifyMode === 'invalid') return 'ROSTRO NO RECONOCIDO';

        const diccionario = {
            1: 'ACCESO CONCEDIDO (Tarjeta válida)',
            9: 'DENEGADO (Tarjeta no válida)',
            75: 'ACCESO CONCEDIDO (Usuario identificado por rostro)',
            76: 'DENEGADO (Usuario Inexistente)',
            112: 'CONECTADO EN EL PANEL',
            21: 'PUERTA ABIERTA',
            22: 'PUERTA CERRADA',
            24: 'EVENTO DE PUERTA / MANTENIMIENTO',
            26: 'PUERTA CERRADA NORMALMENTE',
            27: 'PUERTA ANORMALMENTE ABIERTA'
        };
        return diccionario[codigo] || `EVENTO ${codigo}`;
    }
}