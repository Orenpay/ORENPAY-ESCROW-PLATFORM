import express, { Express, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import getDbPool from '../config/db'; // Import the function to get the pool
// Corrected import paths
import { createUsersTable } from '../server/models/User'; // Import the table creation function
import { createOrdersTable } from '../server/models/Order'; // Import Order table creation
import { createTransactionsTable } from '../server/models/Transaction'; // Import Transaction table creation
import authRoutes from '../server/routes/auth'; // Import authentication routes
import orderRoutes from '../server/routes/order'; // Import order routes
import adminRoutes from '../server/routes/admin'; // Import admin routes
import paymentRoutes from '../server/routes/payment'; // Import payment routes

// Load environment variables first
dotenv.config();

// Initialize Express app
const app: Express = express();

// Middleware
app.use(cors()); // Enable CORS for all origins (adjust for production)
app.use(express.json()); // Parse JSON request bodies

const initializeDatabase = async () => {
    try {
        const pool = getDbPool(); // Get the initialized pool
        // Optional: Test the connection
        await pool.query('SELECT NOW()');
        console.log('Database connection successful.');

        // Ensure all required tables exist
        await createUsersTable();
        await createOrdersTable(); // Add this line
        await createTransactionsTable(); // Add this line

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
