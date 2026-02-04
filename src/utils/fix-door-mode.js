import DigestFetch from 'digest-fetch';

const CONFIG = {
    ip: '10.10.10.175',
    user: 'admin',
    pass: 'R3d3s1pc4..'
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function desbloquearRostro() {
    console.log('🕵️ Leyendo configuración global de acceso...');

    // 1. URL de Configuración Global
    const url = `http://${CONFIG.ip}/ISAPI/AccessControl/AcsCfg?format=json`;

    try {
        // Primero LEEMOS cómo está configurado ahora
        const getRes = await client.fetch(url, { method: 'GET' });
        const currentConfig = await getRes.json();

        console.log('--- ESTADO ACTUAL ---');
        console.log('Modo actual:', currentConfig.AcsCfg?.authMode || "Desconocido");

        // 2. PREPARAMOS EL CAMBIO
        // authMode: 
        // "card": Solo tarjeta
        // "face": Solo cara
        // "cardOrFace": Cualquiera de los dos (LO QUE QUEREMOS)

        const newConfig = {
            AcsCfg: {
                ...currentConfig.AcsCfg, // Mantenemos el resto de la config igual
                authMode: "cardOrFace"   // <-- FORZAMOS EL CAMBIO AQUÍ
            }
        };

        console.log('\n🔧 Forzando modo "Tarjeta O Rostro"...');

        const putRes = await client.fetch(url, {
            method: 'PUT',
            body: JSON.stringify(newConfig),
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await putRes.json();

        if (result.statusCode === 1 || result.statusString === 'OK') {
            console.log('✅ ¡EXITO! Configuración guardada.');
            console.log('👉 Prueba pasar el rostro ahora. Debería funcionar.');
        } else {
            console.log('⚠️ Error al guardar:', result);
        }

    } catch (error) {
        console.error('Error crítico:', error.message);
        console.log('Tip: Si falla el JSON, este modelo podría exigir XML para este endpoint específico.');
    }
}

desbloquearRostro();