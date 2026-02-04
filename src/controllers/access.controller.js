import { parseStringPromise } from 'xml2js';
import { cAccessService } from "../services/access.service.js";

const accessService = new cAccessService();

export class cAccessController {

    async receiveEvent(req, res) {
        try {
            let rawData = '';

            if (req.body.event_log) {
                rawData = req.body.event_log;
            } else if (Object.keys(req.body).length > 0) {
                rawData = Object.keys(req.body)[0];
            }

            const stringData = String(rawData).trim();

            if (!stringData || stringData.length < 5) {
                return res.json({ status: 'ok' });
            }

            let eventObject = null;

            if (stringData.startsWith('{')) {
                try {
                    eventObject = JSON.parse(stringData);
                } catch (e) { console.error('Error JSON:', e.message); }
            }
            else if (stringData.startsWith('<')) {
                try {
                    const parsed = await parseStringPromise(stringData, { explicitArray: false, ignoreAttrs: true });
                    eventObject = parsed.EventNotificationAlert;
                } catch (e) { console.error('Error XML:', e.message); }
            }

            if (eventObject) {
                const fotoFile = req.files ? req.files.find(f => f.mimetype.includes('image')) : null;

                const log = await accessService.processEvent(eventObject, fotoFile);

                if (log) {
                    console.log('¡ACCESO REGISTRADO!');
                    console.table(log);
                    console.log('-------------------------------------------');
                } else {
                    console.log('Heartbeat (Ignorado)');
                }
            }

            res.json({ status: 'ok' });

        } catch (error) {
            console.error('Error Controlado:', error.message);
            res.status(200).json({ status: 'error' });
        }
    }
}