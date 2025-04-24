import { Pool } from 'pg';
import db from '../../config/db';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'disputed' | 'completed' | 'cancelled' | 'refunded' | 'processing_payout';

export interface Order {
    id?: number;
    buyer_id: number;
    seller_id: number;
    item_description: string;
    amount: number; // Consider using a library like decimal.js for precision if needed
    status?: OrderStatus;
    payment_method?: string; // e.g., 'mpesa', 'airtel', 'equity'
    proof_of_delivery_url?: string;
    created_at?: Date;
    // Add transaction_id if linking directly, or manage via Transaction model
    // transaction_id?: number;
}

export const createOrder = async (order: Omit<Order, 'id' | 'status' | 'created_at'>): Promise<Order> => {
    const pool: Pool = db();
    const { buyer_id, seller_id, item_description, amount, payment_method } = order;
    const res = await pool.query(
        `INSERT INTO orders (buyer_id, seller_id, item_description, amount, payment_method, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING *`,
        [buyer_id, seller_id, item_description, amount, payment_method]
    );
    return res.rows[0];
};

export const findOrderById = async (id: number): Promise<Order | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

export const updateOrderStatus = async (id: number, status: OrderStatus, proofUrl?: string): Promise<Order | null> => {
    const pool: Pool = db();
    let query = 'UPDATE orders SET status = $1';
    const values: (string | number | null)[] = [status, id];

    if (status === 'shipped' && proofUrl) {
        query += ', proof_of_delivery_url = $3';
        values.splice(1, 0, proofUrl); // Insert proofUrl before id
    }
    query += ' WHERE id = $2 RETURNING *;';

    // Adjust index for WHERE clause if proofUrl was added
    if (values.length > 2) {
         query = query.replace('$2', '$3');
    }

    const res = await pool.query(query, values);
    return res.rows.length > 0 ? res.rows[0] : null;
};

export const findOrdersByUserId = async (userId: number, role: 'buyer' | 'seller'): Promise<Order[]> => {
    const pool: Pool = db();
    const column = role === 'buyer' ? 'buyer_id' : 'seller_id';
    const res = await pool.query(`SELECT * FROM orders WHERE ${column} = $1 ORDER BY created_at DESC`, [userId]);
    return res.rows;
};

/**
 * Finds orders by their status.
 * @param status - The status to filter orders by.
 * @returns An array of orders matching the status.
 */
export const findOrdersByStatus = async (status: OrderStatus): Promise<Order[]> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY created_at DESC', [status]);
    return res.rows;
};

// Function to create the orders table
export const createOrdersTable = async () => {
    const pool: Pool = db();
    const query = `
        CREATE TABLE IF NOT EXISTS orders (
          id SERIAL PRIMARY KEY,
          buyer_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- Keep order record even if user deleted?
          seller_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          item_description TEXT NOT NULL,
          amount NUMERIC(12, 2) NOT NULL, -- Increased precision
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'disputed', 'completed', 'cancelled', 'refunded', 'processing_payout')),
          payment_method VARCHAR(20),
          proof_of_delivery_url TEXT,
          created_at TIMESTAMP DEFAULT NOW()
          -- Consider adding updated_at TIMESTAMP
        );
    `;
    await pool.query(query);
    console.log("Orders table checked/created successfully.");
};
