import express from "express";
import { body, param } from "express-validator";
import {Punishment, UserToken} from "../models/models.js";
import { verifyToken, checkRole, validate } from "../middleware/authMiddleware.js";
import onlineUsers, { getUserSocketId, removeUser } from "../utils/onlineUsers.js";

const router = express.Router();

router.post("/mute/:id", verifyToken, checkRole(["admin"]), validate([
        param("id").trim().isInt().escape().withMessage("Invalid user ID"),
        body("reason").trim().isString().escape().optional(),
        body("duration").trim().optional()]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        const { reason, duration } = req.body;
        const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null;
        try {
            const mute = await Punishment.create({
                userId: targetUserId,
                type: "mute",
                reason: reason || "No reason provided",
                expiresAt,
            });
            const io = req.app.get("io");
            const targetSocketId = getUserSocketId(targetUserId);
            if (targetSocketId) {
                io.to(targetSocketId).emit("user_muted", { userId: targetUserId, reason: mute.reason, expiresAt });
            }
            io.emit("notify_user_muted", { userId: targetUserId, reason: mute.reason, expiresAt });

            if (expiresAt) {
                setTimeout(async () => {
                    await Punishment.destroy({ where: { userId: targetUserId, type: "mute" } });
                    io.emit("user_unmuted", { userId: targetUserId });
                }, duration * 60 * 1000);
            }

            res.json({ message: `User ${targetUserId} has been muted.`, reason: mute.reason, expiresAt });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to mute user." });
        }
    }
);

router.post("/unmute/:id", verifyToken, checkRole(["admin"]), validate([
    param("id").trim().isInt().escape().withMessage("Invalid user ID")]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        try {
            await Punishment.destroy({ where: { userId: targetUserId, type: "mute" } });
            const io = req.app.get("io");
            io.emit("user_unmuted", { userId: targetUserId });
            res.json({ message: `User ${targetUserId} has been unmuted.` });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to unmute user." });
        }
    }
);

router.post("/ban/:id", verifyToken, checkRole(["admin"]), validate([
        param("id").trim().isInt().escape().withMessage("Invalid user ID"),
        body("reason").trim().isString().escape().optional(),
        body("duration").trim().optional({ nullable: true })]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        const { reason, duration } = req.body;
        const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null;

        try {
            // Invalidate all tokens for this user
            await UserToken.update(
                { isValid: false },
                {
                    where: {
                        userId: targetUserId,
                        isValid: true
                    }
                }
            );

            const ban = await Punishment.create({
                userId: targetUserId,
                type: "ban",
                reason: reason || "No reason provided",
                expiresAt,
            });

            const io = req.app.get("io");
            const targetSocketId = onlineUsers.getUserSocketId(targetUserId);
            if (targetSocketId) {
                io.to(targetSocketId).emit("user_banned", { userId: targetUserId, reason: ban.reason, expiresAt });
                io.sockets.sockets.get(targetSocketId)?.disconnect(true);
                onlineUsers.removeUser(targetUserId);
            }
            io.emit("notify_user_banned", { userId: targetUserId, reason: ban.reason, expiresAt });

            if (expiresAt) {
                setTimeout(async () => {
                    await Punishment.destroy({ where: { userId: targetUserId, type: "ban" } });
                    io.emit("user_unbanned", { userId: targetUserId });
                }, duration * 60 * 1000);
            }

            res.json({ message: `User ${targetUserId} has been banned.`, reason: ban.reason, expiresAt });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to ban user." });
        }
    }
);

router.post("/unban/:id", verifyToken, checkRole(["admin"]), validate([
    param("id").trim().isInt().escape().withMessage("Invalid user ID")]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        try {
            await Punishment.destroy({ where: { userId: targetUserId, type: "ban" } });
            res.json({ message: `User ${targetUserId} has been unbanned.` });
            const io = req.app.get("io");
            io.emit("user_unbanned", { userId: targetUserId });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to unban user." });
        }
    }
);

router.post("/kick/:id", verifyToken, checkRole(["admin"]), validate([
        param("id").trim().isInt().escape().withMessage("Invalid user ID")]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        try {
            // Invalidate the current session
            const token = req.headers.authorization?.split(' ')[1];
            if (token) {
                await UserToken.update(
                    { isValid: false },
                    { where: { token } }
                );
            }

            const io = req.app.get("io");
            const targetSocketId = onlineUsers.getUserSocketId(targetUserId);
            if (targetSocketId) {
                io.to(targetSocketId).emit("user_kicked");
                io.sockets.sockets.get(targetSocketId)?.disconnect(true);
                onlineUsers.removeUser(targetUserId);
            }
            res.json({ message: `User ${targetUserId} has been kicked.` });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Failed to kick user." });
        }
    }
);


export default router;