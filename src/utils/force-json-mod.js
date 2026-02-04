import DigestFetch from 'digest-fetch';

const CONFIG = {
    ip: '10.10.10.175',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function forzarModoJSON() {
    const url = `http://${CONFIG.ip}/ISAPI/AccessControl/AcsCfg?format=json`;

    console.log('🔧 Intentando inyectar configuración en JSON...');

    // PREPARAMOS EL PAYLOAD EN JSON
    // Aunque el dispositivo no nos mostró "authMode", se lo enviamos
    // para obligarlo a cambiar su comportamiento interno.
    const jsonPayload = {
        AcsCfg: {
            authMode: "cardOrFace"
        }
    };

    try {
        const putRes = await client.fetch(url, {
            method: 'PUT',
            body: JSON.stringify(jsonPayload),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await putRes.json();

        console.log('--- RESPUESTA DEL DISPOSITIVO ---');
        console.log(JSON.stringify(result, null, 2));

        if (result.statusCode === 1 || result.statusString === 'OK') {
            console.log('\n🎉 ¡VICTORIA! Configuración JSON aceptada.');
            console.log('👉 IMPORTANTE: Ejecuta "node setup-device.js" de nuevo para reconectar y luego prueba tu cara.');
        } else {
            console.log('\n⚠️ Error: El dispositivo rechazó el comando.');
            if (result.subStatusCode === 'notSupport') {
                console.log('❌ DIAGNÓSTICO FINAL: Este firmware NO permite cambiar el modo de autenticación por código.');
                console.log('SOLUCIÓN ÚNICA: Debes hacerlo desde la pantalla táctil del aparato.');
            }
        }

    } catch (e) {
        console.error('Error de conexión o parseo:', e.message);
    }
}

forzarModoJSON();