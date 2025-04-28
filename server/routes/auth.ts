import express from 'express';
import { register, login, getMe, logout, verifyEmail, verifyPhone, resendEmailVerification, resendPhoneOtp, updateProfile } from '../controllers/authController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.get('/verify-email', verifyEmail); // Email verification via token
router.post('/verify-phone', verifyPhone); // Phone verification via OTP
router.post('/resend-email-verification', resendEmailVerification);
router.post('/resend-phone-otp', resendPhoneOtp);

// Protected routes (require authentication)
router.get('/me', authenticateToken, getMe); // Get current user info
router.post('/logout', authenticateToken, logout); // Logout (optional server-side handling)
router.put('/profile', authenticateToken, updateProfile); // Update user profile (authenticated)

export default router;
