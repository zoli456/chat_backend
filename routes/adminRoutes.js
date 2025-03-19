const { Punishment } = require("../models");
const {verifyToken, checkRole} = require("../middleware/authMiddleware");
const express = require("express");
const {getUserSocketId, removeUserBySocketId, removeUser} = require("../utils/onlineUsers");
const router = express.Router();

router.post("/mute/:id", verifyToken, checkRole(["admin"]), async (req, res) => {
    const { id: targetUserId } = req.params;
    const { reason, duration } = req.body;

    const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null; // Convert minutes to milliseconds

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
            io.to(targetSocketId).emit("user_muted", {userId: targetUserId, reason: mute.reason, expiresAt});
        }
        io.emit("notify_user_muted", {userId: targetUserId, reason: mute.reason, expiresAt});
        if (expiresAt) {
            setTimeout(async () => {
                await Punishment.destroy({ where: { userId: targetUserId, type: "mute" } });
                io.emit("user_unmuted", { userId:targetUserId });
            }, duration * 60 * 1000);
        }

        res.json({ message: `User ${targetUserId} has been muted.`, reason: mute.reason, expiresAt });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to mute user." });
    }
});

router.post("/unmute/:id", verifyToken, checkRole(["admin"]), async (req, res) => {
    const { id: targetUserId } = req.params;
    try {
        await Punishment.destroy({ where: { userId: targetUserId, type: "mute" } });
        const io = req.app.get("io");
        io.emit("user_unmuted", { userId:targetUserId });
        res.json({ message: `User ${targetUserId} has been unmuted.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to unmute user." });
    }
});

router.post("/ban/:id", verifyToken, checkRole(["admin"]), async (req, res) => {
    const { id: targetUserId } = req.params;
    const { reason, duration } = req.body;

    const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null; // Convert hours to milliseconds

    try {
        const ban = await Punishment.create({
            userId: targetUserId,
            type: "ban",
            reason: reason || "No reason provided",
            expiresAt,
        });

        const io = req.app.get("io");
        const targetSocketId = getUserSocketId(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit("user_banned", {userId: targetUserId, reason: ban.reason, expiresAt});
        }
        io.emit("notify_user_banned", {userId: targetUserId, reason: ban.reason, expiresAt});
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
});

router.post("/unban/:id", verifyToken, checkRole(["admin"]), async (req, res) => {
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
});

router.post("/kick/:id", verifyToken, checkRole(["admin"]), async (req, res) => {
    const { id: targetUserId } = req.params;

    try {
        const io = req.app.get("io");
        const targetSocketId = getUserSocketId(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit("user_kicked");
            io.sockets.sockets.get(targetSocketId)?.disconnect(true);
            removeUser(targetUserId);
        }

        res.json({ message: `User ${targetUserId} has been kicked.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to kick user." });
    }
});

module.exports = router;