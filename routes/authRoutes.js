import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import {User, Role, Punishment, UserToken} from "../models/models.js";
import rateLimit from "express-rate-limit";
import * as onlineUsers from "../utils/onlineUsers.js";
import { Op } from "sequelize";
import {validate, verifyToken, verifyTokenWithBlacklist} from "../middleware/authMiddleware.js";

const router = express.Router();
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: "Too many login attempts. Please try again later." },
    headers: true,
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 2,
    message: { error: "Too many registration attempts. Please try again later." },
    headers: true,
});

// Helper function to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
};

// Helper function to get device info
const getDeviceInfo = (req) => {
    return req.headers['user-agent'] || 'Unknown device';
};

router.post("/register", registerLimiter, validate([
    body("username").trim().isString().isLength({ min: 3 }).escape().withMessage("Username must be at least 3 characters long"),
    body("email").trim().isString().isEmail().escape().withMessage("Invalid email format"),
    body("password").trim().isString().isLength({ min: 6 }).escape().withMessage("Password must be at least 6 characters long"),
    body("confirmPassword").trim().isString().escape()
        .custom((value, { req }) => {
            if (value !== req.body.password) {
                throw new Error("Passwords do not match");
            }
            return true;
        }),
    body("gender").trim().isString().isIn(["Male", "Female"]).escape().withMessage("Invalid gender selection"),
    body("birthdate").trim().isString().isISO8601().escape().withMessage("Invalid birthdate format (YYYY-MM-DD)"),
    body("captchaToken").notEmpty().withMessage("Captcha verification is required"),
]), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { captchaToken } = req.body;
        const verifyUrl = 'https://hcaptcha.com/siteverify';

        const verificationResponse = await fetch(verifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                secret: process.env.HCAPTCHA_SECRET_KEY,
                response: captchaToken
            }).toString()
        });

        const verificationData = await verificationResponse.json();

        if (!verificationData.success) {
            return res.status(400).json({
                error: "Captcha verification failed",
                details: verificationData['error-codes'] || []
            });
        }

        const { username, email, password, gender, birthdate } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ username, email, password: hashedPassword, gender, birthdate });

        const defaultRole = await Role.findOrCreate({ where: { name: "user" } });
        await user.addRole(defaultRole[0]);

        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(400).json({ error: "Registration failed" });
    }
});

router.post("/login", loginLimiter, validate([
    body("captchaToken").notEmpty().withMessage("Captcha verification is required"),
    body("username").trim().isString().escape().notEmpty().withMessage("Username is required"),
    body("password").trim().isString().escape().notEmpty().withMessage("Password is required"),
]), async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { captchaToken } = req.body;
        const verifyUrl = 'https://hcaptcha.com/siteverify';

        const verificationResponse = await fetch(verifyUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                secret: process.env.HCAPTCHA_SECRET_KEY,
                response: captchaToken
            }).toString()
        });

        const verificationData = await verificationResponse.json();

        if (!verificationData.success) {
            return res.status(400).json({
                error: "Captcha verification failed",
                details: verificationData['error-codes'] || []
            });
        }

        const { username, password } = req.body;
        const user = await User.findOne({
            where: { username },
            include: Role
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (onlineUsers.getUserSocketId(user.id)) {
            return res.status(403).json({error: "You are already logged in from another device."});
        }

        const activeBan = await Punishment.findOne({
            where: {
                userId: user.id,
                type: "ban",
                expiresAt: { [Op.or]: [null, { [Op.gt]: new Date() }] },
            }
        });

        if (activeBan) {
            const banEnd = activeBan.expiresAt
                ? ` Your ban ends on ${new Date(activeBan.expiresAt).toLocaleString()}`
                : " This ban is permanent.";

            return res.status(403).json({
                error: `You are banned. Reason: ${activeBan.reason}.${banEnd}`
            });
        }

        const existingTokens = await UserToken.findAll({
            where: {
                userId: user.id,
                isValid: true,
                expiresAt: { [Op.gt]: new Date() }
            }
        });

        if (existingTokens.length > 5) {
            return res.status(403).json({
                error: "You have too many active logins",
                sessions: existingTokens.map(t => ({
                    createdAt: t.createdAt,
                    deviceInfo: t.deviceInfo,
                    ipAddress: t.ipAddress
                }))
            });
        }

        const roles = user.Roles.map(role => role.name);
        const token = jwt.sign({ username: user.username, id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        await UserToken.create({
            token,
            userId: user.id,
            expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour
            deviceInfo: getDeviceInfo(req),
            ipAddress: getClientIp(req)
        });

        res.json({ token, roles });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed" });
    }
});

router.post("/logout", verifyTokenWithBlacklist, async (req, res) => {
    try {
        // Invalidate the current token
        await req.tokenRecord.update({ isValid: false });

        // Force disconnect socket if user is online
        const io = req.app.get("io");
        const socketId = onlineUsers.getUserSocketId(req.user.id);
        if (socketId) {
            //io.to(socketId).emit("force_logout");
            io.sockets.sockets.get(socketId)?.disconnect(true);
            onlineUsers.removeUser(req.user.id);
        }

        res.json({ message: "Successfully logged out" });
    } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Logout failed" });
    }
});

router.get("/sessions", verifyTokenWithBlacklist, async (req, res) => {
    try {
        const sessions = await UserToken.findAll({
            where: {
                userId: req.user.id,
                isValid: true,
                expiresAt: { [Op.gt]: new Date() }
            },
            attributes: ['id', 'createdAt', 'deviceInfo', 'ipAddress']
        });
        res.json({ sessions });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: "Failed to fetch sessions" });
    }
});

router.post("/sessions/revoke/:id", verifyTokenWithBlacklist, async (req, res) => {
    try {
        const session = await UserToken.findOne({
            where: {
                id: req.params.id,
                userId: req.user.id
            }
        });

        if (!session) {
            return res.status(404).json({ error: "Session not found" });
        }

        await session.update({ isValid: false });

        // If this is the current session, force logout
        if (session.token === req.headers.authorization?.split(' ')[1]) {
            const io = req.app.get("io");
            const socketId = onlineUsers.getUserSocketId(req.user.id);
            if (socketId) {
                //io.to(socketId).emit("force_logout");
                io.sockets.sockets.get(socketId)?.disconnect(true);
                onlineUsers.removeUser(req.user.id);
            }
        }

        res.json({ message: "Session revoked successfully" });
    } catch (error) {
        console.error("Error revoking session:", error);
        res.status(500).json({ error: "Failed to revoke session" });
    }
});

export default router;