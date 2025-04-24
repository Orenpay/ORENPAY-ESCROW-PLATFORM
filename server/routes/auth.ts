import express from 'express';
import { register, login, getMe, logout } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes (require authentication)
router.get('/me', authenticateToken, getMe); // Get current user info
router.post('/logout', authenticateToken, logout); // Logout (optional server-side handling)

export default router;
