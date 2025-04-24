import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { createUser, findUserByEmail, User } from '../models/User';
import { generateToken } from '../utils/token';
import dotenv from 'dotenv';

dotenv.config();

const BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS ? parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) : 10;

/**
 * Handles user registration.
 */
export const register = async (req: Request, res: Response): Promise<void> => {
    const { full_name, email, phone_number, password, role, location, address, kyc_url } = req.body;

    // Basic validation
    if (!email || !password || !role || !full_name) {
        res.status(400).json({ message: 'Full name, email, password, and role are required.' });
        return;
    }
    if (!['buyer', 'seller', 'business'].includes(role)) {
         res.status(400).json({ message: 'Invalid role specified.' });
         return;
    }

    try {
        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            res.status(409).json({ message: 'Email already in use.' });
            return;
        }

        // Hash password
        const password_hash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

        // Create user data object
        const newUserInput: Omit<User, 'id' | 'created_at'> = {
            full_name,
            email,
            phone_number,
            password_hash,
            role,
            location,
            address,
            kyc_url // Assuming this might come from a file upload middleware later
        };

        // Save user to database
        const createdUser = await createUser(newUserInput);

        // Exclude password hash from the response
        const { password_hash: _, ...userWithoutPassword } = createdUser;

        // Generate JWT token
        const token = generateToken(createdUser.id!, createdUser.role);

        res.status(201).json({ user: userWithoutPassword, token });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Internal server error during registration.' });
    }
};

/**
 * Handles user login.
 */
export const login = async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Email and password are required.' });
        return;
    }

    try {
        // Find user by email
        const user = await findUserByEmail(email);
        if (!user) {
            res.status(401).json({ message: 'Invalid credentials.' }); // User not found
            return;
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            res.status(401).json({ message: 'Invalid credentials.' }); // Password doesn't match
            return;
        }

        // Generate JWT token
        const token = generateToken(user.id!, user.role);

        // Exclude password hash from the response user object
        const { password_hash, ...userWithoutPassword } = user;

        res.status(200).json({ user: userWithoutPassword, token });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error during login.' });
    }
};

/**
 * Gets the currently authenticated user's information.
 * Requires the authenticateToken middleware to run first.
 */
export const getMe = async (req: Request, res: Response): Promise<void> => {
    // req.user is populated by the authenticateToken middleware
    if (!req.user) {
        // This case should ideally be handled by the middleware itself
        res.status(401).json({ message: 'Not authenticated.' });
        return;
    }
    // The user object attached already excludes the password hash
    res.status(200).json({ user: req.user });
};

/**
 * Handles user logout.
 * Note: JWT logout is typically handled client-side by deleting the token.
 * This endpoint can be used for server-side cleanup if needed (e.g., token blacklisting).
 */
export const logout = (req: Request, res: Response): void => {
    // For stateless JWT, logout is primarily client-side (deleting the token).
    // If using refresh tokens or a server-side session/blacklist, add logic here.
    res.status(200).json({ message: 'Logout successful. Please delete the token client-side.' });
};
