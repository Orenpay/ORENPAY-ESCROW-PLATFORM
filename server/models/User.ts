import { Pool } from 'pg';
import db from '../../config/db'; // Assuming db connection pool is exported from config
import bcrypt from 'bcrypt';
import { z } from 'zod';

// Define the User type/interface based on the schema
export interface User {
    id?: number;
    full_name: string;
    email: string;
    phone_number?: string;
    password_hash: string;
    role: 'buyer' | 'seller' | 'business' | 'admin';
    location?: string;
    street_address?: string;
    city?: string;
    state_or_region?: string;
    postal_code?: string;
    country?: string;
    kyc_url?: string;
    created_at?: Date;
    is_email_verified?: boolean;
    is_phone_verified?: boolean;
    email_verification_token?: string | null;
    email_verification_token_expires?: Date | null;
    phone_verification_otp?: string | null;
    phone_verification_otp_expires?: Date | null;
    deleted_at?: Date | null;
    created_by?: number;
    updated_by?: number;
    updated_at?: Date;
}

export interface GetUsersOptions {
    limit?: number;
    offset?: number;
    role?: string;
    search?: string;
}

// Zod schema for user input validation
export const userInputSchema = z.object({
    full_name: z.string().min(1, 'Full name is required'),
    email: z.string().email('Invalid email address'),
    phone_number: z.string().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    role: z.enum(['buyer', 'seller', 'business', 'admin']),
    location: z.string().optional(),
    street_address: z.string().optional(),
    city: z.string().optional(),
    state_or_region: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
    kyc_url: z.string().optional(),
});

// Helper functions for password security
export const hashPassword = async (plainPassword: string): Promise<string> => {
    const saltRounds = 10;
    return await bcrypt.hash(plainPassword, saltRounds);
};

export const verifyPassword = async (plainPassword: string, hash: string): Promise<boolean> => {
    return await bcrypt.compare(plainPassword, hash);
};

// Helper function to map timestamp fields to Date objects
function mapUserTimestamps(user: any): User {
    if (!user) return user;
    return {
        ...user,
        created_at: user.created_at ? new Date(user.created_at) : undefined,
        deleted_at: user.deleted_at ? new Date(user.deleted_at) : undefined,
        email_verification_token_expires: user.email_verification_token_expires ? new Date(user.email_verification_token_expires) : undefined,
        phone_verification_otp_expires: user.phone_verification_otp_expires ? new Date(user.phone_verification_otp_expires) : undefined,
        updated_at: user.updated_at ? new Date(user.updated_at) : undefined,
    };
}

// Basic functions to interact with the users table
// More complex queries can be added as needed

export const createUser = async (user: Omit<User, 'id' | 'created_at'> & { created_by?: number }): Promise<User> => {
    try {
        const pool: Pool = await db(); // Get the pool instance
        const { full_name, email, phone_number, password_hash, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_by } = user;
        const res = await pool.query(
            `INSERT INTO users (full_name, email, phone_number, password_hash, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING id, full_name, email, phone_number, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_at, created_by`,
            [full_name, email, phone_number, password_hash, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_by || null]
        );
        return res.rows[0];
    } catch (error) {
        console.error('Error creating user:', error);
        throw new Error('Failed to create user.');
    }
};

export const findUserByEmail = async (email: string): Promise<User | null> => {
    try {
        const pool: Pool = await db();
        const res = await pool.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
        return res.rows.length > 0 ? mapUserTimestamps(res.rows[0]) : null;
    } catch (error) {
        console.error('Error finding user by email:', error);
        throw new Error('Failed to find user by email.');
    }
};

export const findUserById = async (id: number): Promise<User | null> => {
    try {
        const pool: Pool = await db();
        const res = await pool.query('SELECT id, full_name, email, phone_number, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_at FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
        return res.rows.length > 0 ? mapUserTimestamps(res.rows[0]) : null;
    } catch (error) {
        console.error('Error finding user by id:', error);
        throw new Error('Failed to find user by id.');
    }
};

// Add function to find user by email or phone
export const findUserByEmailOrPhone = async (identifier: string): Promise<User | null> => {
    try {
        const pool: Pool = await db();
        // Check if identifier looks like an email
        const isEmail = identifier.includes('@');
        const query = isEmail
            ? 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL'
            : 'SELECT * FROM users WHERE phone_number = $1 AND deleted_at IS NULL';
        const res = await pool.query(query, [identifier]);
        return res.rows.length > 0 ? mapUserTimestamps(res.rows[0]) : null;
    } catch (error) {
        console.error('Error finding user by email or phone:', error);
        throw new Error('Failed to find user by email or phone.');
    }
};

// Add other necessary functions like updateUser, deleteUser etc.

export const updateUser = async (id: number, updates: Partial<User> & { updated_by?: number }): Promise<User | null> => {
    try {
        const pool: Pool = await db();
        const fields = Object.keys(updates);
        if (fields.length === 0) return null;
        // Always update updated_at
        fields.push('updated_at');
        (updates as any)['updated_at'] = new Date();
        const setClause = fields.map((field, idx) => `${field} = $${idx + 2}`).join(', ');
        const values = [id, ...fields.map(f => (updates as any)[f])];
        const query = `UPDATE users SET ${setClause} WHERE id = $1 AND deleted_at IS NULL RETURNING *`;
        const res = await pool.query(query, values);
        return res.rows.length > 0 ? mapUserTimestamps(res.rows[0]) : null;
    } catch (error) {
        console.error('Error updating user:', error);
        throw new Error('Failed to update user.');
    }
};

export const deleteUser = async (id: number): Promise<boolean> => {
    try {
        const pool: Pool = await db();
        const res = await pool.query(
            'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
            [id]
        );
        return res.rows.length > 0;
    } catch (error) {
        console.error('Error deleting user:', error);
        throw new Error('Failed to delete user.');
    }
};

export const getUsers = async (options: GetUsersOptions = {}): Promise<User[]> => {
    try {
        const pool: Pool = await db();
        const { limit = 20, offset = 0, role, search } = options;
        let query = 'SELECT * FROM users WHERE deleted_at IS NULL';
        const params: any[] = [];
        let paramIdx = 1;
        if (role) {
            query += ` AND role = $${paramIdx++}`;
            params.push(role);
        }
        if (search) {
            query += ` AND (full_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx})`;
            params.push(`%${search}%`);
            paramIdx++;
        }
        query += ` ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`;
        params.push(limit, offset);
        const res = await pool.query(query, params);
        return res.rows.map(mapUserTimestamps);
    } catch (error) {
        console.error('Error getting users:', error);
        throw new Error('Failed to get users.');
    }
};

// Function to create the users table if it doesn't exist (useful for setup)
export const createUsersTable = async () => {
    const pool: Pool = await db();
    const query = `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(100) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          phone_number VARCHAR(20),
          password_hash TEXT NOT NULL,
          role VARCHAR(20) NOT NULL CHECK (role IN ('buyer', 'seller', 'business', 'admin')),
          location VARCHAR(100),
          street_address TEXT,
          city VARCHAR(100),
          state_or_region VARCHAR(100),
          postal_code VARCHAR(20),
          country VARCHAR(100),
          kyc_url TEXT, -- Link to Cloudinary file
          is_email_verified BOOLEAN DEFAULT FALSE,
          is_phone_verified BOOLEAN DEFAULT FALSE,
          email_verification_token VARCHAR(255),
          email_verification_token_expires TIMESTAMP,
          phone_verification_otp VARCHAR(10),
          phone_verification_otp_expires TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          deleted_at TIMESTAMP DEFAULT NULL,
          created_by INTEGER,
          updated_by INTEGER,
          updated_at TIMESTAMP DEFAULT NOW()
        );
    `;
    await pool.query(query);
    console.log("Users table checked/created successfully.");
};

// Blacklist table for JWT tokens
export const createTokenBlacklistTable = async () => {
    const pool: Pool = await db();
    const query = `
        CREATE TABLE IF NOT EXISTS token_blacklist (
            id SERIAL PRIMARY KEY,
            token TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `;
    await pool.query(query);
    console.log("Token blacklist table checked/created successfully.");
};

export const blacklistToken = async (token: string, expiresAt: Date) => {
    const pool: Pool = await db();
    await pool.query(
        'INSERT INTO token_blacklist (token, expires_at) VALUES ($1, $2)',
        [token, expiresAt]
    );
};

export const isTokenBlacklisted = async (token: string): Promise<boolean> => {
    const pool: Pool = await db();
    const res = await pool.query(
        'SELECT 1 FROM token_blacklist WHERE token = $1 AND expires_at > NOW() LIMIT 1',
        [token]
    );
    return res.rows.length > 0;
};
