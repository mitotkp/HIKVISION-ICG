import DigestFetch from 'digest-fetch';

// --- 1. CONFIGURACIÓN DEL DISPOSITIVO HIKVISION ---
const HIK_DEVICE = {
    ip: '192.168.1.64',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

// --- 2. CONFIGURACIÓN DE TU SERVIDOR (NODE.JS) ---
const MY_SERVER = {
    ip: '10.38.52.61',
    port: 6060,
    path: '/api/hikvision/event'
};

const client = new DigestFetch(HIK_DEVICE.user, HIK_DEVICE.pass);

const targetUrl = `http://${HIK_DEVICE.ip}/ISAPI/Event/notification/httpHosts/1`;

// --- EL PAYLOAD EN XML (Lo que el dispositivo exige) ---
// Le decimos: "Configúrate con este XML, pero mándame los eventos en JSON"
const xmlPayload = `
<HttpHostNotification xmlns="http://www.hikvision.com/ver20/XMLSchema">
    <id>1</id>
    <url>${MY_SERVER.path}</url>
    <protocolType>HTTP</protocolType>
    <parameterFormatType>XML</parameterFormatType> <addressingFormatType>ipaddress</addressingFormatType>
    <ipAddress>${MY_SERVER.ip}</ipAddress>
    <portNo>${MY_SERVER.port}</portNo>
    <httpAuthenticationMethod>none</httpAuthenticationMethod>
    <anprMode>detection</anprMode>
    <uploadImages>true</uploadImages>
</HttpHostNotification>
`;

console.log(`Conectando con ${HIK_DEVICE.ip}...`);
console.log(`Enviando configuración XML...`);

async function configureDevice() {
    try {
        const response = await client.fetch(targetUrl, {
            method: 'PUT',
            body: xmlPayload,
            headers: {
                'Content-Type': 'application/xml' // Header clave para que no de error 5
            }
        });

        const textResponse = await response.text();

        console.log(textResponse);

        // Intentamos parsear la respuesta (que vendrá en XML) para ver si fue OK
        if (response.status === 200 && textResponse.includes('<statusCode>1</statusCode>')) {
            console.log('\n¡ÉXITO TOTAL!');
            console.log('El dispositivo aceptó la configuración XML.');
            console.log(`Esperando eventos en: http://${MY_SERVER.ip}:${MY_SERVER.port}${MY_SERVER.path}`);
        } else {
            console.error('\n El dispositivo respondió con error o advertencia:');
            console.log(textResponse);
        }

    } catch (error) {
        console.error('\nError de conexión:', error.message);
    }
}

configureDevice();