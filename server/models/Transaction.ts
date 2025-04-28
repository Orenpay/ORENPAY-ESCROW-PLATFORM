import { Pool } from 'pg';
import db from '../../config/db';

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'refunded' | 'processing' | 'skipped';

// Represents a payment attempt or status update
export interface Transaction {
    id?: number;
    order_id: number;
    user_id: number; // User who initiated or is related to the transaction (buyer, seller, admin)
    provider: string; // e.g., 'mpesa', 'airtel', 'equity', 'system', 'mpesa_b2c', 'mpesa_reversal'
    provider_ref?: string; // Reference from provider (e.g., M-Pesa Tx ID, CheckoutRequestID, OriginatorConversationID)
    amount: number;
    // Add 'skipped' status for actions not performed (e.g., payout for non-implemented method)
    status: 'pending' | 'success' | 'failed' | 'refunded' | 'processing' | 'skipped';
    description?: string;
    created_at?: Date;
    // Add fields for callback details
    provider_status_code?: string; // Status code from provider callback (e.g., '0' for M-Pesa success)
    provider_status_desc?: string; // Status description from provider callback
    provider_transaction_id?: string; // Final transaction ID from provider callback (e.g., M-Pesa B2C Tx ID)
    updated_at?: Date; // Timestamp for last update
}

export const createTransaction = async (transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<Transaction> => {
    const pool: Pool = db();
    const { order_id, user_id, provider, provider_ref, amount, status, description } = transaction;
    const res = await pool.query(
        `INSERT INTO transactions (order_id, user_id, provider, provider_ref, amount, status, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [order_id, user_id, provider, provider_ref, amount, status, description]
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
 * @param details - An object containing optional fields to update (description, provider_ref, provider_status_code, provider_status_desc, provider_transaction_id, provider_timestamp).
 * @returns The updated transaction or null if not found.
 */
export const updateTransactionDetails = async (
    id: number,
    status: 'pending' | 'success' | 'failed' | 'refunded' | 'processing' | 'skipped',
    details: {
        description?: string;
        provider_ref?: string;
        provider_status_code?: string;
        provider_status_desc?: string;
        provider_transaction_id?: string;
        provider_timestamp?: string; // <-- Added for provider timestamp
    }
): Promise<Transaction | null> => {
    const pool: Pool = db();
    const updates: string[] = [];
    const values: (string | number | null | undefined)[] = [];
    let valueIndex = 1;

    updates.push(`status = $${valueIndex++}`);
    values.push(status);

    if (details.description !== undefined) {
        updates.push(`description = $${valueIndex++}`);
        values.push(details.description);
    }
    if (details.provider_ref !== undefined) {
        updates.push(`provider_ref = $${valueIndex++}`);
        values.push(details.provider_ref);
    }
    if (details.provider_status_code !== undefined) {
        updates.push(`provider_status_code = $${valueIndex++}`);
        values.push(details.provider_status_code);
    }
    if (details.provider_status_desc !== undefined) {
        updates.push(`provider_status_desc = $${valueIndex++}`);
        values.push(details.provider_status_desc);
    }
    if (details.provider_transaction_id !== undefined) {
        updates.push(`provider_transaction_id = $${valueIndex++}`);
        values.push(details.provider_transaction_id);
    }

    values.push(id); // Add the id for the WHERE clause

    const query = `UPDATE transactions SET ${updates.join(', ')} WHERE id = $${valueIndex} RETURNING *`;

    try {
        const res = await pool.query(query, values);
        return res.rows.length > 0 ? res.rows[0] : null;
    } catch (error: any) {
        // Handle potential unique constraint violation on provider_ref if updated
        if (error.code === '23505' && error.constraint === 'transactions_provider_ref_key') {
            console.error(`Error updating transaction ${id}: Provider reference '${details.provider_ref}' already exists.`);
            // Decide how to handle: maybe fetch existing and update that one? Or just log error.
            // For now, just log and return null
            return null;
        } else {
            console.error(`Error updating transaction ${id}:`, error);
            throw error; // Re-throw other errors
        }
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
          order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE, -- Cascade delete if order is removed
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Keep transaction log even if user deleted
          provider VARCHAR(50) NOT NULL,
          provider_ref VARCHAR(100) UNIQUE, -- Make provider ref unique if it should be (e.g., CheckoutRequestID)
          amount NUMERIC(12, 2) NOT NULL,
          -- Add 'skipped' to CHECK constraint
          status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'refunded', 'processing', 'skipped')),
          description TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          -- Add new columns for callback details
          provider_status_code VARCHAR(50),
          provider_status_desc TEXT,
          provider_transaction_id VARCHAR(100)
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
