import DigestFetch from 'digest-fetch';
import fs from 'fs';

const CONFIG = {
    ip: '10.10.10.185',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function probarPayloadsDefinitivos() {
    console.log(`🔓 Probando CaptureFaceData con Schema VER 1.0 en ${CONFIG.ip}...\n`);

    const url = `http://${CONFIG.ip}/ISAPI/AccessControl/CaptureFaceData`;

    // INTENTO 1: XML con Namespace VER 1.0 (Lo que tu dispositivo pidió en el error)
    const xmlVer1 = `
    <CaptureFaceDataCond version="1.0" xmlns="http://www.hikvision.com/ver10/XMLSchema">
        <captureInfrared>false</captureInfrared>
    </CaptureFaceDataCond>`;

    console.log('🔹 INTENTO 1: XML ver10 (CaptureFaceDataCond)...');
    await probar(url, xmlVer1, 'application/xml');

    // INTENTO 2: XML sin Namespace (A veces funciona mejor)
    const xmlSimple = `<CaptureFaceDataCond><captureInfrared>false</captureInfrared></CaptureFaceDataCond>`;
    console.log('\n🔹 INTENTO 2: XML Simple...');
    await probar(url, xmlSimple, 'application/xml');

    // INTENTO 3: JSON con clave "CaptureFaceData" (Sin "Cond")
    const jsonDirect = { CaptureFaceData: { captureInfrared: false } };
    console.log('\n🔹 INTENTO 3: JSON (CaptureFaceData)...');
    await probar(url + '?format=json', jsonDirect, 'application/json');
}

async function probar(url, body, contentType) {
    try {
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

        const res = await client.fetch(url, {
            method: 'POST',
            body: bodyStr,
            headers: { 'Content-Type': contentType }
        });

        console.log(`   Resultado: ${res.status} ${res.statusText}`);
        const text = await res.text();

        if (res.ok) {
            console.log('   🎉 ¡FUNCIONÓ!');
            console.log('   Respuesta:', text.substring(0, 300));

            // Si devuelve URL, es un éxito total
            if (text.includes('url') || text.includes('http')) {
                console.log('   ✅ URL de foto detectada.');
            }
        } else {
            // Buscamos el error específico
            const match = text.match(/<subStatusCode>(.*?)<\/subStatusCode>/);
            const error = match ? match[1] : text.substring(0, 100);
            console.log(`   ❌ Falló: ${error}`);
        }
    } catch (e) {
        console.log('   ⚠️ Error de red:', e.message);
    }
}

probarPayloadsDefinitivos();