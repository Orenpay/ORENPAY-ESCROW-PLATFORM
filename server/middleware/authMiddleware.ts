import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/token';
import { findUserById, User } from '../models/User'; // Assuming User model exports User type

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
export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) {
        return res.sendStatus(401); // if there isn't any token
    }

    const payload = verifyToken(token);

    if (!payload) {
        return res.sendStatus(403); // if token is invalid or expired
    }

    try {
        // Fetch user details from DB based on token payload (optional but good practice)
        const user = await findUserById(payload.id);
        if (!user) {
            return res.sendStatus(403); // User not found
        }
        // Exclude password hash before attaching to request
        const { password_hash, ...userWithoutPassword } = user;
        req.user = userWithoutPassword; // Attach user info to the request object
        next(); // pass the execution off to whatever request the client intended
    } catch (error) {
        console.error("Error fetching user during authentication:", error);
        res.sendStatus(500);
    }
};

/**
 * Middleware to authorize requests based on user roles.
 * Must be used *after* authenticateToken middleware.
 * @param allowedRoles - An array of roles allowed to access the route.
 */
export const authorizeRole = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.role) {
            // This should technically not happen if authenticateToken runs first
            return res.status(403).json({ message: 'Authentication required.' });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: `Forbidden: Role '${req.user.role}' is not authorized.` });
        }

        next(); // role is allowed, proceed to the next middleware/handler
    };
};
