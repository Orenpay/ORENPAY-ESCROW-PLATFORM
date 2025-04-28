import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/token';
import { findUserById, User, isTokenBlacklisted } from '../models/User'; // Assuming User model exports User type

// Extend Express Request interface to include user property
declare global {
    namespace Express {
        interface Request {
            user?: Omit<User, 'password_hash'>; // Add user property, excluding password hash
        }
    }
}

/**
 * Middleware to authenticate requests using JWT.
 * Attaches user information (excluding password) to the request object if authenticated.
 */
export const authenticateToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        res.sendStatus(401); // if there isn't any token
        return; // Explicitly return void
    }

    // Check if token is blacklisted
    if (await isTokenBlacklisted(token)) {
        res.status(401).json({ message: 'Token is blacklisted. Please login again.' });
        return;
    }

    const payload = verifyToken(token);

    if (!payload) {
        res.sendStatus(403); // if token is invalid or expired
        return; // Explicitly return void
    }

    try {
        // Fetch user details from DB based on token payload (optional but good practice)
        const user = await findUserById(payload.id);
        if (!user) {
            res.sendStatus(403); // User not found
            return; // Explicitly return void
        }
        // Exclude password hash before attaching to request
        const { password_hash, ...userWithoutPassword } = user;
        req.user = userWithoutPassword; // Attach user info to the request object
        next(); // pass the execution off to whatever request the client intended
    } catch (error) {
        console.error("Error fetching user during authentication:", error);
        res.sendStatus(500);
        // No return needed here as sendStatus ends the response
    }
};

/**
 * Middleware to authorize requests based on user roles.
 * Must be used *after* authenticateToken middleware.
 * @param allowedRoles - An array of roles allowed to access the route.
 */
export const authorizeRole = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => { // Explicitly return void
        if (!req.user || !req.user.role) {
            // This should technically not happen if authenticateToken runs first
            res.status(403).json({ message: 'Authentication required.' });
            return; // Return void
        }

        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({ message: `Forbidden: Role '${req.user.role}' is not authorized.` });
            return; // Return void
        }

        next(); // Call next middleware if authorized
    };
}; // Add the missing closing brace
