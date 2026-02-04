import DigestFetch from 'digest-fetch';

const CONFIG = {
    ip: '10.10.10.185',
    user: 'admin',
    pass: 'R3d3s1pc4..',
    testId: "6" // <--- CAMBIA ESTO POR UN ID DE CLIENTE QUE EXISTA
};

const client = new DigestFetch(CONFIG.user, CONFIG.pass);

async function probarBusquedaDeTarjetas() {
    console.log(`🕵️ Probando búsqueda de tarjetas para el ID: ${CONFIG.testId}`);

    // 1. PRIMERO: Probamos el "Count" (Conteo) como sugiere el diagrama
    // Esto nos dice si el dispositivo reconoce tarjetas para ese usuario
    const countUrl = `http://${CONFIG.ip}/ISAPI/AccessControl/CardInfo/Count?format=json&employeeNo=${CONFIG.testId}`;

    try {
        console.log('\n--- PASO 1: GET Count (Verificar cantidad) ---');
        const resCount = await client.fetch(countUrl, { method: 'GET' });
        const jsonCount = await resCount.json();
        console.log('Respuesta Count:', JSON.stringify(jsonCount, null, 2));
    } catch (e) { console.log('Fallo en Count (puede que no esté soportado):', e.message); }

    // 2. SEGUNDO: Probamos el "Search" (Búsqueda) con el payload corregido
    const searchUrl = `http://${CONFIG.ip}/ISAPI/AccessControl/CardInfo/Search?format=json`;
    const payload = {
        CardInfoSearchCond: {
            searchID: "TestScript123",
            searchResultPosition: 0, // CRÍTICO
            maxResults: 5,
            EmployeeNoList: [{ employeeNo: CONFIG.testId }]
        }
    };

    try {
        console.log('\n--- PASO 2: POST Search (Obtener datos) ---');
        const resSearch = await client.fetch(searchUrl, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        const jsonSearch = await resSearch.json();
        console.log('Respuesta Search:', JSON.stringify(jsonSearch, null, 2));

        if (jsonSearch.CardInfoSearch?.CardInfo) {
            console.log('\n✅ ¡Tarjetas encontradas!');
        } else {
            console.log('\n⚠️ No se encontraron tarjetas o el formato falló.');
        }

    } catch (e) { console.log('Error Fatal:', e.message); }
}

probarBusquedaDeTarjetas();