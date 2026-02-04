import DigestFetch from 'digest-fetch';

const CONFIG = {
    ip: '10.10.10.175',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function forzarModoXML() {
    const url = `http://${CONFIG.ip}/ISAPI/AccessControl/AcsCfg`; // Sin ?format=json

    console.log('🕵️ 1. Consultando configuración actual (RAW)...');

    try {
        // PASO 1: VER LA VERDAD (GET)
        const getRes = await client.fetch(url, { method: 'GET' });
        const rawText = await getRes.text();

        console.log('\n--- LO QUE EL DISPOSITIVO RESPONDE REALMENTE ---');
        console.log(rawText.substring(0, 500)); // Imprimimos los primeros 500 caracteres
        console.log('------------------------------------------------\n');

        // PASO 2: FORZAR EL CAMBIO (PUT con XML)
        console.log('🔧 2. Enviando orden de desbloqueo en XML...');

        const xmlPayload = `
<AcsCfg xmlns="http://www.hikvision.com/ver20/XMLSchema">
    <authMode>cardOrFace</authMode>
</AcsCfg>
`;

        const putRes = await client.fetch(url, {
            method: 'PUT',
            body: xmlPayload,
            headers: {
                'Content-Type': 'application/xml'
            }
        });

        const resultText = await putRes.text();

        console.log('--- RESPUESTA AL INTENTO DE CAMBIO ---');
        console.log(resultText);

        if (resultText.includes('<statusCode>1</statusCode>') || resultText.includes('OK')) {
            console.log('\n🎉 ¡VICTORIA! El dispositivo aceptó el cambio a XML.');
            console.log('👉 Ve ahora mismo y pasa el rostro.');
        } else {
            console.log('\n⚠️ El dispositivo se resiste. Revisa el mensaje de error arriba.');
        }

    } catch (e) {
        console.error('Error de conexión:', e.message);
    }
}

forzarModoXML();