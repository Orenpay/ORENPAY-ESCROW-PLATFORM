import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import getDbPool from '../config/db'; // Import the function to get the pool
// Corrected import paths
import { createUsersTable } from '../server/models/User'; // Import the table creation function
import { createOrdersTable } from '../server/models/Order'; // Import Order table creation
import { createTransactionsTable } from '../server/models/Transaction'; // Import Transaction table creation
// Import new model table creation functions
import { createAgentsTable } from '../server/models/Agent';
import { createShipmentsTable } from '../server/models/Shipment';
import { createShipmentLegsTable } from '../server/models/ShipmentLeg';
import authRoutes from '../server/routes/auth'; // Import authentication routes
import orderRoutes from '../server/routes/order'; // Import order routes
import adminRoutes from '../server/routes/admin'; // Import admin routes
import paymentRoutes from '../server/routes/payment'; // Import payment routes
// Import new route files - Corrected paths relative to src/
import agentRoutes from '../server/routes/agent';
import shipmentRoutes from '../server/routes/shipment';

// Load environment variables first
dotenv.config();

// Define a type for requests that might have a rawBody
interface RequestWithRawBody extends Request {
    rawBody?: Buffer;
}

// Initialize Express app
const app: Express = express();

// Middleware
app.use(cors()); // Enable CORS for all origins (adjust for production)

// Use express.json() with a verify function to capture the raw body
app.use(express.json({
    verify: (req: RequestWithRawBody, res, buf, encoding) => {
        if (buf && buf.length) {
            req.rawBody = buf; // Attach raw body buffer to the request object
        }
    }
}));

const initializeDatabase = async () => {
    try {
        const pool = getDbPool(); // Get the initialized pool
        // Optional: Test the connection
        await pool.query('SELECT NOW()');
        console.log('Database connection successful.');

        // Ensure all required tables exist
        await createUsersTable();
        await createOrdersTable();
        await createTransactionsTable();
        // Add calls for new tables
        await createAgentsTable();
        await createShipmentsTable();
        await createShipmentLegsTable();

    } catch (error) {
        console.error('Failed to connect to the database or setup tables:', error);
        process.exit(1); // Exit if DB connection fails
    }
};

// --- API Routes ---
app.get('/', (req: Request, res: Response) => {
    res.send('OrenPay Escrow API is running!');
});

// Mount authentication routes
app.use('/api/auth', authRoutes);

// Mount order routes
app.use('/api/orders', orderRoutes);

// Mount admin routes
app.use('/api/admin', adminRoutes);

// Mount payment routes
app.use('/api/payments', paymentRoutes);

// Mount agent routes
app.use('/api/agents', agentRoutes);

// Mount shipment routes
app.use('/api/shipments', shipmentRoutes);

// --- Initialize DB and Start Server ---
const startServer = async () => {
    await initializeDatabase(); // Ensure DB is ready before starting

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
};

startServer().catch(error => {
    console.error("Failed to start the server:", error);
    process.exit(1);
});
