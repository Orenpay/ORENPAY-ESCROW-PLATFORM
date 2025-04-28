import express from 'express';
import {
    registerAgentProfile,
    getAgentProfile,
    updateAgentLocationStatus,
    findNearbyAvailableAgents,
    adminUpdateAgentKyc // Import admin function
} from '../controllers/agentController';
import { authenticateToken, authorizeRole } from '../middleware/authMiddleware';

const router = express.Router();

// --- Agent Routes (Require Authentication) ---
router.use(authenticateToken);

// POST /api/agents/register - Register agent profile for the authenticated user
// Requires user to be logged in, might need specific role check later (e.g., 'agent' role)
router.post('/register', registerAgentProfile);

// GET /api/agents/profile - Get the agent profile for the authenticated user
// Assumes the user is an agent
router.get('/profile', getAgentProfile);

// PUT /api/agents/status - Update agent's status and location
// Assumes the user is an agent
router.put('/status', updateAgentLocationStatus);

// GET /api/agents/nearby - Find available agents near a location (potentially for admin/system use)
// Add role check if needed (e.g., only admin or system service can call this)
router.get('/nearby', findNearbyAvailableAgents);

// --- Admin Routes for Agents ---
// PUT /api/agents/:agentId/kyc - Admin updates agent KYC status
router.put('/:agentId/kyc', authorizeRole(['admin']), adminUpdateAgentKyc);


export default router;
