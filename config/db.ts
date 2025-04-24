import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables from .env file

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error("FATAL ERROR: DATABASE_URL is not defined in the .env file.");
    process.exit(1);
}

let pool: Pool | null = null;

const getDbPool = (): Pool => {
    if (!pool) {
        console.log("Creating new PostgreSQL connection pool...");
        pool = new Pool({
            connectionString: databaseUrl,
            // Optional: Add SSL configuration if required for your database provider (e.g., Render, Heroku)
            // ssl: {
            //   rejectUnauthorized: false // Adjust based on your provider's requirements
            // }
        });

        pool.on('connect', () => {
            console.log('Connected to the PostgreSQL database!');
        });

        pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            // Optionally try to reconnect or exit
            // process.exit(-1);
        });
    }
    return pool;
};

// Export a function that returns the initialized pool
// This ensures the pool is created only when first needed
export default getDbPool;
