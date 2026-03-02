import { Router, Request, Response, NextFunction } from 'express';
import { validate } from '../middleware/validate.middleware';
import { verifyJWT } from '../middleware/auth.middleware';
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../validators/auth.validators';
import {
  loginUser,
  registerUser,
  refreshTokens,
  logoutUser,
  changePassword,
} from '../../services/auth.service';

const router = Router();

// POST /auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password, req.ip, req.headers['user-agent']);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /auth/register
router.post('/register', validate(registerSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await registerUser({ ...req.body, tenantId: req.body.tenantId });
    res.status(201).json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// POST /auth/refresh
router.post('/refresh', validate(refreshTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokens = await refreshTokens(req.body.refreshToken);
    res.json({ success: true, ...tokens });
  } catch (err) {
    next(err);
  }
});

// POST /auth/logout
router.post('/logout', verifyJWT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await logoutUser(req.body.refreshToken, req.user!.sub);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /auth/me
router.get('/me', verifyJWT, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../../config/database');
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        tenantId: true,
        lastLoginAt: true,
        createdAt: true,
        agent: { select: { id: true, level: true, specialization: true, status: true } },
        tenant: { select: { id: true, name: true, timezone: true } },
      },
    });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
});

// POST /auth/change-password
router.post('/change-password', verifyJWT, validate(changePasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await changePassword(req.user!.sub, req.body.currentPassword, req.body.newPassword);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
