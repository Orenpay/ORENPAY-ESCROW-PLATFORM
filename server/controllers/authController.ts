import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { createUser, findUserByEmail, User, blacklistToken, userInputSchema, hashPassword } from '../models/User';
import { generateToken } from '../utils/token';
import dotenv from 'dotenv';
import { sendSmsNotification, sendEmailVerification } from '../services/notificationService';
import { findUserByEmailOrPhone } from '../models/User';
import jwt from 'jsonwebtoken';

dotenv.config();

const BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS ? parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) : 10;

/**
 * Handles user registration.
 */
export const register = async (req: Request, res: Response): Promise<void> => {
    // Validate input using Zod
    const parseResult = userInputSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({
            message: 'Validation failed',
            errors: parseResult.error.errors.map(e => e.message)
        });
        return;
    }
    const { full_name, email, phone_number, password, role, location, street_address, city, state_or_region, postal_code, country, kyc_url } = parseResult.data;

    try {
        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
            res.status(409).json({ message: 'Email already in use.' });
            return;
        }

        // Hash password using helper
        const password_hash = await hashPassword(password);

        // Generate email verification token and expiry (24h)
        const email_verification_token = crypto.randomBytes(32).toString('hex');
        const email_verification_token_expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        // Generate phone OTP and expiry (10 min)
        const phone_verification_otp = (Math.floor(100000 + Math.random() * 900000)).toString();
        const phone_verification_otp_expires = new Date(Date.now() + 10 * 60 * 1000);

        // Create user data object
        const newUserInput: Omit<User, 'id' | 'created_at'> = {
            full_name,
            email,
            phone_number,
            password_hash,
            role,
            location,
            street_address,
            city,
            state_or_region,
            postal_code,
            country,
            kyc_url,
            is_email_verified: false,
            is_phone_verified: false,
            email_verification_token,
            email_verification_token_expires,
            phone_verification_otp,
            phone_verification_otp_expires
        };

        // Save user to database
        const createdUser = await createUser(newUserInput);

        // Send verification email and SMS (implementations assumed in notificationService)
        if (email) {
            sendEmailVerification(email, email_verification_token);
        }
        if (phone_number) {
            sendSmsNotification(phone_number, `Your OrenPay verification code is: ${phone_verification_otp}`);
        }

        // Exclude password hash and tokens from the response
        const { password_hash: _, email_verification_token: __, phone_verification_otp: ___, ...userWithoutSensitive } = createdUser;

        // Generate JWT token
        const token = generateToken(createdUser.id!, createdUser.role);

        res.status(201).json({ user: userWithoutSensitive, token, message: 'Registration successful. Please verify your email and phone.' });

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
 * Adds the JWT to the blacklist table on logout, using the token's expiry.
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
    // Extract token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        res.status(400).json({ message: 'No token provided.' });
        return;
    }
    try {
        // Decode token to get expiry
        const decoded: any = jwt.decode(token);
        if (!decoded || !decoded.exp) {
            res.status(400).json({ message: 'Invalid token.' });
            return;
        }
        // Convert exp (seconds) to JS Date
        const expiresAt = new Date(decoded.exp * 1000);
        await blacklistToken(token, expiresAt);
        res.status(200).json({ message: 'Logout successful. Token blacklisted.' });
    } catch (err) {
        res.status(500).json({ message: 'Error blacklisting token.' });
    }
};

/**
 * Verifies user email using a token.
 * GET /api/auth/verify-email?token=...
 */
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        res.status(400).json({ message: 'Verification token is required.' });
        return;
    }
    try {
        const pool = await require('../../config/db').default();
        const userRes = await pool.query(
            'SELECT * FROM users WHERE email_verification_token = $1',
            [token]
        );
        const user = userRes.rows[0];
        if (!user) {
            res.status(400).json({ message: 'Invalid or expired verification token.' });
            return;
        }
        if (user.is_email_verified) {
            res.status(200).json({ message: 'Email already verified.' });
            return;
        }
        if (!user.email_verification_token_expires || new Date(user.email_verification_token_expires) < new Date()) {
            res.status(400).json({ message: 'Verification token has expired.' });
            return;
        }
        await pool.query(
            'UPDATE users SET is_email_verified = TRUE, email_verification_token = NULL, email_verification_token_expires = NULL WHERE id = $1',
            [user.id]
        );
        res.status(200).json({ message: 'Email verified successfully.' });
    } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ message: 'Internal server error during email verification.' });
    }
};

/**
 * Verifies user phone using OTP.
 * POST /api/auth/verify-phone { phone_number, otp }
 */
export const verifyPhone = async (req: Request, res: Response): Promise<void> => {
    const { phone_number, otp } = req.body;
    if (!phone_number || !otp) {
        res.status(400).json({ message: 'Phone number and OTP are required.' });
        return;
    }
    try {
        const pool = await require('../../config/db').default();
        const userRes = await pool.query(
            'SELECT * FROM users WHERE phone_number = $1',
            [phone_number]
        );
        const user = userRes.rows[0];
        if (!user) {
            res.status(400).json({ message: 'User not found.' });
            return;
        }
        if (user.is_phone_verified) {
            res.status(200).json({ message: 'Phone already verified.' });
            return;
        }
        if (!user.phone_verification_otp || user.phone_verification_otp !== otp) {
            res.status(400).json({ message: 'Invalid OTP.' });
            return;
        }
        if (!user.phone_verification_otp_expires || new Date(user.phone_verification_otp_expires) < new Date()) {
            res.status(400).json({ message: 'OTP has expired.' });
            return;
        }
        await pool.query(
            'UPDATE users SET is_phone_verified = TRUE, phone_verification_otp = NULL, phone_verification_otp_expires = NULL WHERE id = $1',
            [user.id]
        );
        res.status(200).json({ message: 'Phone verified successfully.' });
    } catch (error) {
        console.error('Phone verification error:', error);
        res.status(500).json({ message: 'Internal server error during phone verification.' });
    }
};

/**
 * Resends email verification token.
 */
export const resendEmailVerification = async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;
    if (!email) {
        res.status(400).json({ message: 'Email is required.' });
        return;
    }
    try {
        const pool = await require('../../config/db').default();
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = userRes.rows[0];
        if (!user) {
            res.status(404).json({ message: 'User not found.' });
            return;
        }
        if (user.is_email_verified) {
            res.status(200).json({ message: 'Email already verified.' });
            return;
        }
        // Generate new token and expiry
        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await pool.query(
            'UPDATE users SET email_verification_token = $1, email_verification_token_expires = $2 WHERE id = $3',
            [token, expires, user.id]
        );
        await sendEmailVerification(email, token);
        res.status(200).json({ message: 'Verification email resent.' });
        return;
    } catch (error) {
        console.error('Resend email verification error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Resends phone OTP.
 */
export const resendPhoneOtp = async (req: Request, res: Response): Promise<void> => {
    const { phone_number } = req.body;
    if (!phone_number) {
        res.status(400).json({ message: 'Phone number is required.' });
        return;
    }
    try {
        const pool = await require('../../config/db').default();
        const userRes = await pool.query('SELECT * FROM users WHERE phone_number = $1', [phone_number]);
        const user = userRes.rows[0];
        if (!user) {
            res.status(404).json({ message: 'User not found.' });
            return;
        }
        if (user.is_phone_verified) {
            res.status(200).json({ message: 'Phone already verified.' });
            return;
        }
        // Generate new OTP and expiry
        const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000);
        await pool.query(
            'UPDATE users SET phone_verification_otp = $1, phone_verification_otp_expires = $2 WHERE id = $3',
            [otp, expires, user.id]
        );
        await sendSmsNotification(phone_number, `Your OrenPay verification code is: ${otp}`);
        res.status(200).json({ message: 'OTP resent.' });
        return;
    } catch (error) {
        console.error('Resend phone OTP error:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

/**
 * Updates the authenticated user's profile.
 * PUT /api/auth/profile
 */
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
        res.status(401).json({ message: 'Not authenticated.' });
        return;
    }
    // Validate input using Zod
    const parseResult = userInputSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({
            message: 'Validation failed',
            errors: parseResult.error.errors.map(e => e.message)
        });
        return;
    }
    const {
        full_name,
        phone_number,
        location,
        street_address,
        city,
        state_or_region,
        postal_code,
        country,
        kyc_url
    } = parseResult.data;
    try {
        const pool = await require('../../config/db').default();
        const updateFields = [];
        const values = [];
        if (full_name !== undefined) { updateFields.push('full_name = $' + (values.length + 1)); values.push(full_name); }
        if (phone_number !== undefined) { updateFields.push('phone_number = $' + (values.length + 1)); values.push(phone_number); }
        if (location !== undefined) { updateFields.push('location = $' + (values.length + 1)); values.push(location); }
        if (street_address !== undefined) { updateFields.push('street_address = $' + (values.length + 1)); values.push(street_address); }
        if (city !== undefined) { updateFields.push('city = $' + (values.length + 1)); values.push(city); }
        if (state_or_region !== undefined) { updateFields.push('state_or_region = $' + (values.length + 1)); values.push(state_or_region); }
        if (postal_code !== undefined) { updateFields.push('postal_code = $' + (values.length + 1)); values.push(postal_code); }
        if (country !== undefined) { updateFields.push('country = $' + (values.length + 1)); values.push(country); }
        if (kyc_url !== undefined) { updateFields.push('kyc_url = $' + (values.length + 1)); values.push(kyc_url); }
        if (updateFields.length === 0) {
            res.status(400).json({ message: 'No fields to update.' });
            return;
        }
        values.push(userId);
        const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${values.length} RETURNING id, full_name, email, phone_number, role, location, street_address, city, state_or_region, postal_code, country, kyc_url, created_at`;
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            res.status(404).json({ message: 'User not found.' });
            return;
        }
        res.status(200).json({ user: result.rows[0], message: 'Profile updated successfully.' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ message: 'Internal server error during profile update.' });
    }
};
