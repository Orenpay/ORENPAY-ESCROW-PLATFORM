import { Pool } from 'pg';
import db from '../../config/db';

// Define possible statuses for an agent
export type AgentStatus = 'offline' | 'available' | 'busy' | 'suspended';
export type KycStatus = 'pending' | 'verified' | 'rejected';

// Define the Agent interface based on README Phase 2
export interface Agent {
    id?: number;
    user_id: number; // Link to the users table
    name: string; // Could be individual name or Sacco name
    phone: string; // Contact phone
    routes_covered?: string; // Text description or structured data (e.g., JSON)
    is_sacco: boolean;
    is_rider: boolean;
    status?: AgentStatus;
    current_load?: number; // e.g., number of active shipments
    score?: number; // Performance score
    location?: string; // Could store GeoJSON point or similar
    last_ping?: Date; // Timestamp of last status/location update
    kyc_status?: KycStatus;
    created_at?: Date;
    updated_at?: Date;
}

// Function to create the agents table
export const createAgentsTable = async () => {
    const pool: Pool = db();
    const query = `
        CREATE TABLE IF NOT EXISTS agents (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE, -- Agent must be a user, cascade delete if user is removed
            name VARCHAR(255) NOT NULL,
            phone VARCHAR(20) UNIQUE NOT NULL, -- Ensure phone is unique
            routes_covered TEXT, -- Simple text for now, consider JSON or separate table later
            is_sacco BOOLEAN DEFAULT false,
            is_rider BOOLEAN DEFAULT false,
            status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('offline', 'available', 'busy', 'suspended')),
            current_load INTEGER DEFAULT 0,
            score NUMERIC(5, 2) DEFAULT 0.00, -- e.g., 0.00 to 100.00 or similar scale
            location GEOMETRY(Point, 4326), -- Use PostGIS POINT geometry type (SRID 4326 for WGS84)
            last_ping TIMESTAMP,
            kyc_status VARCHAR(20) DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
            -- Add constraint to ensure either is_sacco or is_rider is true, but not both? Or allow both?
            -- CONSTRAINT agent_type_check CHECK (is_sacco <> is_rider) -- Example: Mutually exclusive
        );

        -- Create index on location for faster spatial queries (requires PostGIS extension)
        CREATE INDEX IF NOT EXISTS idx_agents_location ON agents USING GIST (location);

        -- Trigger to update updated_at timestamp
        CREATE OR REPLACE FUNCTION update_modified_column()
        RETURNS TRIGGER AS $$
        BEGIN
           NEW.updated_at = NOW();
           RETURN NEW;
        END;
        $$ language 'plpgsql';

        DROP TRIGGER IF EXISTS update_agents_modtime ON agents; -- Drop existing trigger if necessary
        CREATE TRIGGER update_agents_modtime
        BEFORE UPDATE ON agents
        FOR EACH ROW
        EXECUTE FUNCTION update_modified_column();
    `;
    try {
        // Ensure PostGIS extension is enabled (Best done manually or in migration script)
        // await pool.query('CREATE EXTENSION IF NOT EXISTS postgis;');
        await pool.query(query);
        console.log("Agents table checked/created successfully.");
    } catch (error) {
        console.error("Error creating agents table:", error);
        // Consider re-throwing or handling more gracefully
        throw error;
    }
};

// --- Basic CRUD functions (to be expanded) ---

// Create a new agent profile (linked to an existing user)
export const createAgent = async (agentData: Omit<Agent, 'id' | 'status' | 'current_load' | 'score' | 'location' | 'last_ping' | 'kyc_status' | 'created_at' | 'updated_at'>): Promise<Agent> => {
    const pool: Pool = db();
    const { user_id, name, phone, routes_covered, is_sacco, is_rider } = agentData;
    const res = await pool.query(
        `INSERT INTO agents (user_id, name, phone, routes_covered, is_sacco, is_rider, status, kyc_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'offline', 'pending')
         RETURNING *`,
        [user_id, name, phone, routes_covered, is_sacco, is_rider]
    );
    return res.rows[0];
};

// Find an agent by their user ID
export const findAgentByUserId = async (userId: number): Promise<Agent | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM agents WHERE user_id = $1', [userId]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Find an agent by their agent ID
export const findAgentById = async (id: number): Promise<Agent | null> => {
    const pool: Pool = db();
    const res = await pool.query('SELECT * FROM agents WHERE id = $1', [id]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Update agent details (example: update status and location)
export const updateAgentStatusLocation = async (id: number, status: AgentStatus, latitude: number, longitude: number): Promise<Agent | null> => {
    const pool: Pool = db();
    // Use ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) for PostGIS point
    const res = await pool.query(
        `UPDATE agents
         SET status = $1, location = ST_SetSRID(ST_MakePoint($3, $2), 4326), last_ping = NOW()
         WHERE id = $4
         RETURNING *`,
        [status, latitude, longitude, id]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Update KYC status
export const updateAgentKycStatus = async (id: number, kycStatus: KycStatus): Promise<Agent | null> => {
    const pool: Pool = db();
    const res = await pool.query(
        `UPDATE agents SET kyc_status = $1 WHERE id = $2 RETURNING *`,
        [kycStatus, id]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Find available agents near a location (Example using PostGIS)
// Note: This requires PostGIS extension to be enabled in your PostgreSQL database
export const findAvailableAgentsNearLocation = async (latitude: number, longitude: number, radiusMeters: number): Promise<Agent[]> => {
    const pool: Pool = db();
    const point = `ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`;
    const res = await pool.query(
        `SELECT *, ST_Distance(location, ${point}::geography) as distance_meters
         FROM agents
         WHERE status = 'available'
           AND ST_DWithin(location, ${point}::geography, $1) -- Check within radius
         ORDER BY distance_meters ASC -- Order by nearest first
         LIMIT 10`, // Limit results for performance
        [radiusMeters]
    );
    return res.rows;
};
