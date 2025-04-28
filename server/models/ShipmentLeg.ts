import { Pool } from 'pg';
import db from '../../config/db';

// Define possible statuses for a shipment leg
export type ShipmentLegStatus = 'pending' | 'accepted' | 'in_transit' | 'delivered_to_hub' | 'delivered_to_recipient' | 'failed' | 'cancelled';

// Define the ShipmentLeg interface based on README Phase 2
export interface ShipmentLeg {
    id?: number;
    shipment_id: number; // Link to the shipments table
    leg_number: number; // Sequence number (1, 2, 3...)
    agent_id?: number; // Agent assigned to this leg
    status?: ShipmentLegStatus;
    pickup_location: string; // Origin for this leg
    delivery_location: string; // Destination for this leg
    estimated_pickup_time?: Date;
    actual_pickup_time?: Date;
    estimated_delivery_time?: Date;
    actual_delivery_time?: Date;
    proof_url?: string; // URL for proof of handover/delivery photo
    notes?: string; // Any notes related to this leg
    created_at?: Date;
    updated_at?: Date;
}

// Function to create the shipment_legs table
export const createShipmentLegsTable = async () => {
    const pool: Pool = db();
    const query = `
        CREATE TABLE IF NOT EXISTS shipment_legs (
            id SERIAL PRIMARY KEY,
            shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE, -- Link to parent shipment
            leg_number INTEGER NOT NULL,
            agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL, -- Agent assigned to this specific leg
            status VARCHAR(30) DEFAULT 'pending' CHECK (status IN (
                'pending', 'accepted', 'in_transit', 'delivered_to_hub',
                'delivered_to_recipient', 'failed', 'cancelled'
            )),
            pickup_location TEXT NOT NULL, -- Consider GEOMETRY
            delivery_location TEXT NOT NULL, -- Consider GEOMETRY
            estimated_pickup_time TIMESTAMP,
            actual_pickup_time TIMESTAMP,
            estimated_delivery_time TIMESTAMP,
            actual_delivery_time TIMESTAMP,
            proof_url TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (shipment_id, leg_number) -- Ensure leg numbers are unique per shipment
        );

        -- Index on shipment_id for quick lookup of legs for a shipment
        CREATE INDEX IF NOT EXISTS idx_shipment_legs_shipment_id ON shipment_legs(shipment_id);
        -- Index on agent_id
        CREATE INDEX IF NOT EXISTS idx_shipment_legs_agent_id ON shipment_legs(agent_id);
        -- Index on status
        CREATE INDEX IF NOT EXISTS idx_shipment_legs_status ON shipment_legs(status);

        -- Trigger to update updated_at timestamp (assuming function exists from Agent model)
        DROP TRIGGER IF EXISTS update_shipment_legs_modtime ON shipment_legs; -- Drop existing trigger if necessary
        CREATE TRIGGER update_shipment_legs_modtime
        BEFORE UPDATE ON shipment_legs
        FOR EACH ROW
        EXECUTE FUNCTION update_modified_column();
    `;
    try {
        await pool.query(query);
        console.log("ShipmentLegs table checked/created successfully.");
    } catch (error) {
        console.error("Error creating shipment_legs table:", error);
        throw error;
    }
};

// --- Basic CRUD functions (to be expanded) ---

// Create a new shipment leg
export const createShipmentLeg = async (legData: Omit<ShipmentLeg, 'id' | 'status' | 'actual_pickup_time' | 'actual_delivery_time' | 'proof_url' | 'notes' | 'created_at' | 'updated_at'>): Promise<ShipmentLeg> => {
    const pool: Pool = db();
    const {
        shipment_id,
        leg_number,
        agent_id,
        pickup_location,
        delivery_location,
        estimated_pickup_time,
        estimated_delivery_time
    } = legData;
    const res = await pool.query(
        `INSERT INTO shipment_legs (shipment_id, leg_number, agent_id, pickup_location, delivery_location, estimated_pickup_time, estimated_delivery_time, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [shipment_id, leg_number, agent_id, pickup_location, delivery_location, estimated_pickup_time, estimated_delivery_time]
    );
    return res.rows[0];
};

// Find shipment legs by shipment ID
export const findShipmentLegsByShipmentId = async (shipmentId: number): Promise<ShipmentLeg[]> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM shipment_legs WHERE shipment_id = $1 ORDER BY leg_number ASC', [shipmentId]);
    return res.rows;
};

// Find a specific shipment leg
export const findShipmentLegById = async (id: number): Promise<ShipmentLeg | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM shipment_legs WHERE id = $1', [id]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Update the status of a shipment leg
export const updateShipmentLegStatus = async (id: number, status: ShipmentLegStatus, proofUrl?: string, notes?: string): Promise<ShipmentLeg | null> => {
    const pool: Pool = db();
    let query = 'UPDATE shipment_legs SET status = $1';
    const values: (string | number | null | undefined)[] = [status];
    let valueCounter = 2;

    if (status === 'accepted' || status === 'in_transit') {
        query += `, actual_pickup_time = CASE WHEN $1 = 'accepted' THEN NOW() ELSE actual_pickup_time END`; // Set pickup time on accept
    }
    if (status === 'delivered_to_hub' || status === 'delivered_to_recipient') {
        query += `, actual_delivery_time = NOW()`;
    }
    if (proofUrl !== undefined) {
        query += `, proof_url = $${valueCounter++}`;
        values.push(proofUrl);
    }
     if (notes !== undefined) {
        query += `, notes = $${valueCounter++}`;
        values.push(notes);
    }


    query += ` WHERE id = $${valueCounter} RETURNING *`;
    values.push(id);

    const res = await pool.query(query, values);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Assign an agent to a specific leg
export const assignAgentToLeg = async (id: number, agentId: number): Promise<ShipmentLeg | null> => {
    const pool: Pool = db();
    const res = await pool.query(
        `UPDATE shipment_legs SET agent_id = $1 WHERE id = $2 RETURNING *`,
        [agentId, id]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
};
