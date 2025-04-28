import { Pool } from 'pg';
import db from '../../config/db';

// Define possible statuses for a shipment
export type ShipmentStatus = 'pending_assignment' | 'assigned' | 'in_transit' | 'at_hub' | 'out_for_delivery' | 'delivered' | 'failed' | 'cancelled';

// Define the Shipment interface based on README Phase 2
export interface Shipment {
    id?: number;
    order_id: number; // Link to the orders table
    current_leg?: number; // Sequence number of the active leg
    status?: ShipmentStatus;
    assigned_agent_id?: number; // Current agent responsible (might be redundant if using legs)
    pickup_location: string; // Address or coordinates
    delivery_location: string; // Address or coordinates
    estimated_time?: Date; // Estimated delivery time
    actual_time?: Date; // Actual delivery time
    tracking_code?: string; // Unique tracking code for customer
    created_at?: Date;
    updated_at?: Date;
}

// Function to create the shipments table
export const createShipmentsTable = async () => {
    const pool: Pool = db();
    const query = `
        CREATE TABLE IF NOT EXISTS shipments (
            id SERIAL PRIMARY KEY,
            order_id INTEGER UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE, -- Each order has one shipment
            current_leg INTEGER DEFAULT 1,
            status VARCHAR(30) DEFAULT 'pending_assignment' CHECK (status IN (
                'pending_assignment', 'assigned', 'in_transit', 'at_hub',
                'out_for_delivery', 'delivered', 'failed', 'cancelled'
            )),
            assigned_agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL, -- Agent currently handling (if applicable)
            pickup_location TEXT NOT NULL, -- Consider using GEOMETRY or structured address
            delivery_location TEXT NOT NULL, -- Consider using GEOMETRY or structured address
            estimated_time TIMESTAMP,
            actual_time TIMESTAMP,
            tracking_code VARCHAR(50) UNIQUE, -- Generate a unique code
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        -- Index on order_id for quick lookup
        CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
        -- Index on assigned_agent_id
        CREATE INDEX IF NOT EXISTS idx_shipments_agent_id ON shipments(assigned_agent_id);
        -- Index on status
        CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
        -- Index on tracking_code
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_tracking_code ON shipments(tracking_code);


        -- Trigger to update updated_at timestamp (assuming function exists from Agent model)
        DROP TRIGGER IF EXISTS update_shipments_modtime ON shipments; -- Drop existing trigger if necessary
        CREATE TRIGGER update_shipments_modtime
        BEFORE UPDATE ON shipments
        FOR EACH ROW
        EXECUTE FUNCTION update_modified_column();
    `;
    try {
        await pool.query(query);
        console.log("Shipments table checked/created successfully.");
    } catch (error) {
        console.error("Error creating shipments table:", error);
        throw error;
    }
};

// --- Basic CRUD functions (to be expanded) ---

// Generate a simple unique tracking code
const generateTrackingCode = (): string => {
    const prefix = 'ORN';
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const timestampPart = Date.now().toString().slice(-4);
    return `${prefix}${randomPart}${timestampPart}`;
};


// Create a new shipment record for an order
export const createShipment = async (shipmentData: Omit<Shipment, 'id' | 'current_leg' | 'status' | 'assigned_agent_id' | 'estimated_time' | 'actual_time' | 'tracking_code' | 'created_at' | 'updated_at'>): Promise<Shipment> => {
    const pool: Pool = db();
    const { order_id, pickup_location, delivery_location } = shipmentData;
    const tracking_code = generateTrackingCode();
    const res = await pool.query(
        `INSERT INTO shipments (order_id, pickup_location, delivery_location, tracking_code, status)
         VALUES ($1, $2, $3, $4, 'pending_assignment')
         RETURNING *`,
        [order_id, pickup_location, delivery_location, tracking_code]
    );
    return res.rows[0];
};

// Find a shipment by its ID
export const findShipmentById = async (id: number): Promise<Shipment | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM shipments WHERE id = $1', [id]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Find a shipment by its Order ID
export const findShipmentByOrderId = async (orderId: number): Promise<Shipment | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM shipments WHERE order_id = $1', [orderId]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Find a shipment by its Tracking Code
export const findShipmentByTrackingCode = async (trackingCode: string): Promise<Shipment | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM shipments WHERE tracking_code = $1', [trackingCode]);
    return res.rows.length > 0 ? res.rows[0] : null;
};


// Update shipment status and potentially the current agent/leg
export const updateShipmentStatus = async (id: number, status: ShipmentStatus, agentId?: number | null, currentLeg?: number): Promise<Shipment | null> => {
    const pool: Pool = db();
    let query = 'UPDATE shipments SET status = $1';
    const values: (string | number | null | undefined)[] = [status];
    let valueCounter = 2;

    if (agentId !== undefined) {
        query += `, assigned_agent_id = $${valueCounter++}`;
        values.push(agentId);
    }
    if (currentLeg !== undefined) {
        query += `, current_leg = $${valueCounter++}`;
        values.push(currentLeg);
    }
    if (status === 'delivered') {
        query += `, actual_time = NOW()`;
    }

    query += ` WHERE id = $${valueCounter} RETURNING *`;
    values.push(id);

    const res = await pool.query(query, values);
    return res.rows.length > 0 ? res.rows[0] : null;
};
