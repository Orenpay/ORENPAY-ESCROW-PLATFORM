import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
}

/**
 * Generates a JWT token.
 * @param userId - The user's ID.
 * @param role - The user's role.
 * @returns The generated JWT token.
 */
export const generateToken = (userId: number, role: string): string => {
    return jwt.sign({ id: userId, role }, JWT_SECRET, {
        expiresIn: '1d', // Token expires in 1 day
    });
};

/**
 * Verifies a JWT token.
 * @param token - The JWT token to verify.
 * @returns The decoded payload if the token is valid, otherwise null.
 */
export const verifyToken = (token: string): { id: number; role: string } | null => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded as { id: number; role: string };
    } catch (error) {
        console.error('Invalid token:', error);
        return null;
    }
};
