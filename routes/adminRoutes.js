import express from "express";
import {body, param} from "express-validator";
import {Punishment, Role, User, UserToken} from "../models/models.js";
import {checkRole, validateInput, verifyTokenWithBlacklist} from "../middleware/authMiddleware.js";
import onlineUsers, {getUserSocketId} from "../utils/onlineUsers.js";
import bcrypt from "bcrypt";

const router = express.Router();

router.post("/mute/:id", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
        param("id").trim().isInt().escape().withMessage("Invalid user ID"),
        body("reason").trim().isString().escape().optional(),
        body("duration").optional({ nullable: true }).isInt({ gt: 0 }).withMessage("Duration must be an integer greater than 0")]),
    async (req, res) => {
        const { id: targetUserId } = req.params;
        const { reason, duration } = req.body;
        const expiresAt = duration ? new Date(Date.now() + duration * 60 * 1000) : null;
        try {
            const mute = await Punishment.create({
                userId: targetUserId,
                issuedById: req.user.id,
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

router.post("/unmute/:id", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
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

router.post("/ban/:id", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
        param("id").trim().isInt().escape().withMessage("Invalid user ID"),
        body("reason").trim().isString().escape().optional(),
        body("duration").optional({ nullable: true }).isInt({ gt: 0 }).withMessage("Duration must be an integer greater than 0")]),
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
                    issuedById: req.user.id,
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

router.post("/unban/:id", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
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

router.post("/kick/:id", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
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

router.post("/users/:userId/status", verifyTokenWithBlacklist, checkRole(["admin"]),
    async (req, res) => {
        try {
            const { userId } = req.params;
            const { enabled } = req.body;

            if (typeof enabled !== 'boolean') {
                return res.status(400).json({ error: "Enabled status must be a boolean" });
            }

            const user = await User.findByPk(userId);
            if (!user) {
                return res.status(404).json({ error: "User not found" });
            }

            // Don't allow disabling admin accounts
            if (!enabled) {
                const roles = await user.getRoles();
                if (roles.some(role => role.name === 'admin')) {
                    return res.status(403).json({ error: "Cannot disable admin accounts" });
                }
            }

            // Update user status
            await user.update({ enabled });

            if (!enabled) {
                // Invalidate all active tokens
                await UserToken.update(
                    { isValid: false },
                    {
                        where: {
                            userId: userId,
                            isValid: true
                        }
                    }
                );

                // Disconnect from websocket if online
                const socketId = onlineUsers.getUserSocketId(userId);
                if (socketId) {
                    const io = req.app.get("io");
                    io.sockets.sockets.get(socketId)?.disconnect(true);
                    onlineUsers.removeUser(userId);
                }
            }

            res.json({
                message: `User account ${enabled ? 'enabled' : 'disabled'} successfully`,
                userId,
                enabled
            });

        } catch (error) {
            console.error("Error toggling user status:", error);
            res.status(500).json({ error: "Failed to toggle user status" });
        }
    }
);

router.post("/users/:userId/roles", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
    param("userId").trim().isInt().withMessage("Invalid user ID"),
    body("roleName").trim().isString().withMessage("Role name is required"),
    body("action").trim().isIn(["add", "remove"]).withMessage("Action must be 'add' or 'remove'")
]), async (req, res) => {
    const { userId } = req.params;
    const { roleName, action } = req.body;

    try {
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const role = await Role.findOne({ where: { name: roleName } });
        if (!role) {
            return res.status(404).json({ error: "Role not found" });
        }

        if (action === "add") {
            await user.addRole(role);
            return res.json({ message: `Role '${roleName}' added to user ${userId}` });
        } else if (action === "remove") {
            await user.removeRole(role);
            return res.json({ message: `Role '${roleName}' removed from user ${userId}` });
        }
    } catch (error) {
        console.error("Error updating user roles:", error);
        res.status(500).json({ error: "Failed to update user roles" });
    }
});

router.get("/roles", verifyTokenWithBlacklist, checkRole(["admin"]), async (req, res) => {
    try {
        const roles = await Role.findAll({ attributes: ["id", "name"] });
        res.json(roles);
    } catch (error) {
        console.error("Error fetching roles:", error);
        res.status(500).json({ error: "Failed to fetch roles" });
    }
});

router.post("/change-password/:userId", verifyTokenWithBlacklist, checkRole(["admin"]), validateInput([
        param("userId")
            .notEmpty()
            .withMessage("User ID is required")
            .isInt({ min: 1 })
            .withMessage("User ID must be a positive integer"),
        body("newPassword")
            .trim()
            .isLength({ min: 6, max: 30 })
            .withMessage("New password must be between 6 and 30 characters")
            .isString()
            .escape(),
        body("confirmPassword")
            .trim()
            .custom((value, { req }) => value === req.body.newPassword)
            .withMessage("Confirm password does not match new password")
            .isString()
            .escape(),
    ]),
    async (req, res) => {
        const userId = parseInt(req.params.userId, 10);
        const { newPassword } = req.body;

        try {
            const user = await User.findByPk(userId, {
                include: ["roles"]
            });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            // Check if the target user has 'Admin' role
            const hasAdminRole = user.roles.some(role => role.name === 'Admin');
            if (hasAdminRole) {
                return res.status(403).json({ message: "You cannot change another admin's password" });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            user.password = hashedPassword;
            await user.save();

            res.json({ message: `Password for user ${user.username || user.id} changed successfully` });
        } catch (error) {
            res.status(500).json({ message: "Internal server error", error: error.message });
        }
    }
);

export default router;