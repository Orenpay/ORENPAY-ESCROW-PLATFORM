import { Pool } from 'pg';
import db from '../../config/db'; // Assuming db connection pool is exported from config

// Define the User type/interface based on the schema
export interface User {
    id?: number;
    full_name: string;
    email: string;
    phone_number?: string;
    password_hash: string;
    role: 'buyer' | 'seller' | 'business';
    location?: string;
    address?: string;
    kyc_url?: string;
    created_at?: Date;
}

// Basic functions to interact with the users table
// More complex queries can be added as needed

export const createUser = async (user: Omit<User, 'id' | 'created_at'>): Promise<User> => {
    const pool: Pool = await db(); // Get the pool instance
    const { full_name, email, phone_number, password_hash, role, location, address, kyc_url } = user;
    const res = await pool.query(
        `INSERT INTO users (full_name, email, phone_number, password_hash, role, location, address, kyc_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, full_name, email, phone_number, role, location, address, kyc_url, created_at`,
        [full_name, email, phone_number, password_hash, role, location, address, kyc_url]
    );
    return res.rows[0];
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
    const pool: Pool = await db();
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

export const findUserById = async (id: number): Promise<User | null> => {
    const pool: Pool = await db();
    const res = await pool.query('SELECT id, full_name, email, phone_number, role, location, address, kyc_url, created_at FROM users WHERE id = $1', [id]);
    return res.rows.length > 0 ? res.rows[0] : null;
};

// Add other necessary functions like updateUser, deleteUser etc.

// Function to create the users table if it doesn't exist (useful for setup)
export const createUsersTable = async () => {
    const pool: Pool = await db();
    const query = `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(100),
          email VARCHAR(100) UNIQUE NOT NULL,
          phone_number VARCHAR(20),
          password_hash TEXT NOT NULL,
          role VARCHAR(20) CHECK (role IN ('buyer', 'seller', 'business')),
          location VARCHAR(100),
          address TEXT,
          kyc_url TEXT, -- Link to Cloudinary file
          created_at TIMESTAMP DEFAULT NOW()
        );
    `;
    await pool.query(query);
    console.log("Users table checked/created successfully.");
};
