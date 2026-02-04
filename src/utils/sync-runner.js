import { cSyncService } from '../services/sync.service.js';

const sync = new cSyncService();

async function correr() {
    const clientes = await sync.obtenerClientes();

    if (clientes.length > 0) {
        await sync.enviarClientes(clientes);
    } else {
        console.log('No hay clientes para sincronizar.');
    }
}

correr();