import DigestFetch from 'digest-fetch';

const CONFIG = {
    ip: '10.10.10.175',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function escanearCerebro() {
    console.log('Consultando el esquema JSON exacto del dispositivo...');

    // URL EXACTA DE TU DOCUMENTACIÓN
    const url = `http://${CONFIG.ip}/ISAPI/AccessControl/UserInfo/capabilities?format=json`;

    try {
        const res = await client.fetch(url, { method: 'GET' });
        const json = await res.json();

        console.log('\n--- LO QUE EL DISPOSITIVO ESPERA RECIBIR ---');
        console.log(JSON.stringify(json, null, 2));

        // Verificamos si soporta POST como dice el diagrama
        if (JSON.stringify(json).toLowerCase().includes('post')) {
            console.log('\nCONFIRMADO: El dispositivo acepta creación por POST JSON.');
        } else {
            console.log('\nALERTA: No veo "POST" en las capacidades. Podría ser de solo lectura.');
        }

    } catch (e) {
        console.error('Error:', e.message);
        console.log('Si falla el JSON, prueba ver el texto crudo (podría devolver XML aunque pidamos JSON).');
    }
}

escanearCerebro();