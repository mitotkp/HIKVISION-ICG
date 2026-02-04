//@ts-check
import sql from 'mssql';
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    pool: {
        min: 0,
        max: 15,
        idleTimeoutMillis: 30000,
    },
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
}

/** @type {sql.ConnectionPool | null} */
let pool = null;

export const getConnection = async () => {
    try {
        if (pool) return pool;

        pool = await sql.connect(dbConfig);

        console.log('Conexión exitosa a SQL Server');

        return pool;
    }
    catch (error) {
        console.error('Error al conectar a SQL Server:', error.message);
        throw error;
    }
}

export { sql };