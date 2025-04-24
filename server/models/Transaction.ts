import { Pool } from 'pg';
import db from '../../config/db';

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'refunded';

// Represents a payment attempt or status update
export interface Transaction {
    id?: number;
    order_id: number;
    user_id: number; // User initiating the transaction (usually buyer)
    provider: string; // e.g., 'mpesa', 'airtel', 'equity'
    provider_ref?: string; // Reference ID from the payment provider (e.g., M-Pesa transaction code)
    provider_receipt?: string; // Receipt number from the payment provider
    provider_timestamp?: string; // Timestamp from the payment provider (e.g., M-Pesa timestamp format: YYYYMMDDHHMMSS)
    amount: number;
    status: TransactionStatus;
    description?: string; // e.g., 'STK Push initiated', 'Payment confirmed', 'Refund processed'
    created_at?: Date;
    updated_at?: Date; // Timestamp for last update
}

export const createTransaction = async (transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<Transaction> => {
    const pool: Pool = db();
    const { order_id, user_id, provider, provider_ref, provider_receipt, provider_timestamp, amount, status, description } = transaction;
    const res = await pool.query(
        `INSERT INTO transactions (order_id, user_id, provider, provider_ref, provider_receipt, provider_timestamp, amount, status, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [order_id, user_id, provider, provider_ref, provider_receipt, provider_timestamp, amount, status, description]
    );
    return res.rows[0];
};

export const findTransactionsByOrderId = async (orderId: number): Promise<Transaction[]> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM transactions WHERE order_id = $1 ORDER BY created_at ASC', [orderId]);
    return res.rows;
};

/**
 * Finds a transaction by its provider reference ID (e.g., M-Pesa CheckoutRequestID).
 * @param providerRef - The reference ID from the payment provider.
 * @param provider - The name of the provider (e.g., 'mpesa').
 * @returns The transaction or null if not found.
 */
export const findTransactionByProviderRef = async (providerRef: string, provider: string): Promise<Transaction | null> => {
    const pool: Pool = db();
    const res = await pool.query(
        'SELECT * FROM transactions WHERE provider_ref = $1 AND provider = $2',
        [providerRef, provider]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
};

/**
 * Updates the status and details of a transaction.
 * @param id - The ID of the transaction to update.
 * @param status - The new status.
 * @param details - An object containing optional fields to update (provider_ref, provider_receipt, provider_timestamp, description).
 * @returns The updated transaction or null if not found.
 */
export const updateTransactionDetails = async (
    id: number, 
    status: TransactionStatus, 
    details: { 
        provider_ref?: string; 
        provider_receipt?: string; 
        provider_timestamp?: string; // M-Pesa timestamp format: YYYYMMDDHHMMSS
        description?: string; 
    } = {}
): Promise<Transaction | null> => {
    const pool: Pool = db();
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let valueIndex = 1;

    updates.push(`status = $${valueIndex++}`);
    values.push(status);

    if (details.provider_ref !== undefined) {
        updates.push(`provider_ref = $${valueIndex++}`);
        values.push(details.provider_ref);
    }
    if (details.provider_receipt !== undefined) {
        updates.push(`provider_receipt = $${valueIndex++}`);
        values.push(details.provider_receipt);
    }
    if (details.provider_timestamp !== undefined) {
        updates.push(`provider_timestamp = $${valueIndex++}`); 
        values.push(details.provider_timestamp);
    }
    if (details.description !== undefined) {
        updates.push(`description = $${valueIndex++}`);
        values.push(details.description);
    }

    values.push(id); // For the WHERE clause

    const query = `UPDATE transactions SET ${updates.join(', ')} WHERE id = $${valueIndex} RETURNING *`;

    try {
        const res = await pool.query(query, values);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (error) {
        console.error('Error updating transaction details:', error);
        throw error;
    }
};

// Rename the old update function to avoid confusion
export const updateTransactionStatus_Legacy = async (id: number, status: TransactionStatus, providerRef?: string, description?: string): Promise<Transaction | null> => {
    return updateTransactionDetails(id, status, { provider_ref: providerRef, description: description });
};

// Function to create the transactions table
export const createTransactionsTable = async () => {
    const pool: Pool = db();
    const query = `
        CREATE TABLE IF NOT EXISTS transactions (
          id SERIAL PRIMARY KEY,
          order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE NO ACTION,
          provider VARCHAR(20) NOT NULL,
          provider_ref VARCHAR(100) UNIQUE,
          provider_receipt VARCHAR(100),
          provider_timestamp VARCHAR(20),
          amount NUMERIC(12, 2) NOT NULL,
          status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
          description TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_provider_ref ON transactions (provider_ref);
        
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
           NEW.updated_at = NOW();
           RETURN NEW;
        END;
        $$ language 'plpgsql';

        DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
        CREATE TRIGGER update_transactions_updated_at
        BEFORE UPDATE ON transactions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `;
    try {
        await pool.query(query);
        console.log("Transactions table checked/created successfully with updates.");
    } catch (error) {
        console.error("Error updating transactions table schema:", error);
    }
};
