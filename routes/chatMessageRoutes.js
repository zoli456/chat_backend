import express from "express";
import { body, validationResult, param } from "express-validator";
import { Message, User, Punishment } from "../models/models.js";
import {FilterProfanity, sanitizeContent} from "../middleware/MessageFilter.js";
import { verifyToken, checkBanStatus, checkRole, validate } from "../middleware/authMiddleware.js";
import rateLimit from "express-rate-limit";
import { Op } from "sequelize";

const router = express.Router();
const sendmessageLimiter = rateLimit({
    windowMs:  1000,
    max: 1,
    message: { error: "You are sending message too fast. Please slow down." },
    headers: true,
});

// Fetch the last 30 messages
router.get("/", verifyToken, checkBanStatus, async (req, res) => {
    try {
        const messages = await Message.findAll({
            limit: 30,
            order: [['id', 'DESC']],
            include: [
                {
                    model: User,
                    attributes: [`id`,'username'],
                    include: [
                        {
                            model: Punishment,
                            attributes: ['type'],
                            where: {
                                type: { [Op.in]: ['mute', 'ban'] },
                                [Op.or]: [
                                    { expiresAt: { [Op.gt]: new Date() } },
                                    { expiresAt: null }
                                ]
                            },
                            required: false
                        }
                    ]
                }
            ]
        });
        const processedMessages = messages.map((message) => {
            const msgData = message.get({ plain: true });
            const punishments = msgData.User?.Punishments || [];
            const isMuted = punishments.some(p => p.type === 'mute');
            const isBanned = punishments.some(p => p.type === 'ban');
            return {
                id: msgData.id,
                text: FilterProfanity(msgData.text),
                createdAt: msgData.createdAt,
                User: {
                    userId:msgData.User.id,
                    username: msgData.User.username,
                    isMuted,
                    isBanned
                }
            };
        });

        res.json(processedMessages.reverse());
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ error: "Failed to fetch messages", details: error.message });
    }
});

router.post("/", verifyToken, sendmessageLimiter,
    validate([
        body("text")
            .trim()
            .customSanitizer(sanitizeContent)
            .notEmpty().withMessage("Message cannot be empty")
            .isLength({ min: 1, max: 512 }).withMessage("Message must be between 1 and 512 characters")
            .escape()
    ]),
    async (req, res) => {
        try {
            const { text } = req.body;
            const userId = req.user.id;
            const username = req.user.username;

            const activeMute = await Punishment.findOne({
                where: {
                    userId,
                    type: "mute",
                    [Op.or]: [
                        { expiresAt: null },
                        { expiresAt: { [Op.gt]: new Date() } }
                    ]
                }
            });

            if (activeMute) {
                return res.status(403).json({
                    error: "You are muted and cannot send messages.",
                    expiresAt: activeMute.expiresAt
                });
            }

            const newMessage = await Message.create({
                text: text,
                userId
            });

            const messageWithUser = {
                id: newMessage.id,
                text: FilterProfanity(text),
                userId: newMessage.userId,
                createdAt: newMessage.createdAt,
                updatedAt: newMessage.updatedAt,
                User: { username },
            };

            const io = req.app.get("io");
            io.emit("chat_message", messageWithUser);
            res.status(201).json(messageWithUser);
        } catch (error) {
            console.error("Error sending message:", error);
            res.status(500).json({ error: "Failed to send message" });
        }
    }
);

router.delete("/:id", verifyToken, checkRole(["user"]),
    validate([param("id").trim().isInt({ min: 1 }).withMessage("Invalid message ID").escape()]),
    async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.id;
        const userRoles = req.user.roles || [];
        const message = await Message.findOne({ where: { id: messageId } });
        if (!message) {
            return res.status(404).json({ error: "Message not found" });
        }
        if (message.userId.toString() !== userId.toString() && !userRoles.includes("admin")) {
            return res.status(403).json({ error: "You can only delete your own messages" });
        }
        await message.destroy();
        const io = req.app.get("io");
        io.emit("chat_message_deleted", { id: messageId });
        res.json({ success: true, message: "Message deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete message" });
    }
});
export default router;