const express = require("express");
const { body, validationResult } = require("express-validator");
const { Message, User } = require("../models");
const { FilterMessage } = require("../middleware/FilterProfanity");
const {verifyToken, checkBanStatus, checkRole} = require("../middleware/authMiddleware");
const rateLimit = require("express-rate-limit");
const { Op } = require("sequelize");
const { Punishment } = require("../models");

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
                            attributes: ['type'], // Only fetch type (not included in the final response)
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
                text: FilterMessage(msgData.text),
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

router.post("/", verifyToken, sendmessageLimiter, [
        body("text").isLength({ min: 1, max: 512 }).withMessage("Message must be between 1 and 512 characters"),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const { text } = req.body;
            const userId = req.user.id;
            const username = req.user.username;

            // **Check if user is muted**
            const activeMute = await Punishment.findOne({
                where: {
                    userId,
                    type: "mute",
                    [Op.or]: [
                        { expiresAt: null }, // Permanent mute
                        { expiresAt: { [Op.gt]: new Date() } } // Still active mute
                    ]
                }
            });

            if (activeMute) {
                return res.status(403).json({
                    error: "You are muted and cannot send messages.",
                    expiresAt: activeMute.expiresAt
                });
            }

            // **Process message**
            //const cleanText = FilterMessage(text);
            const newMessage = await Message.create({ text: text, userId });

            const messageWithUser = {
                id: newMessage.id,
                text: text,
                userId: newMessage.userId,
                createdAt: newMessage.createdAt,
                updatedAt: newMessage.updatedAt,
                User: { username },
            };
            // Emit message to other users
            const io = req.app.get("io");
            io.emit("message", messageWithUser);

            res.status(201).json(messageWithUser);
        } catch (error) {
            console.error("Error sending message:", error);
            res.status(500).json({ error: "Failed to send message" });
        }
    }
);

router.delete("/:id", verifyToken, checkRole(["user"]), async (req, res) => {
    try {
        const messageId = req.params.id;
        const userId = req.user.id;
        const userRoles = req.user.roles || [];
        const message = await Message.findOne({ where: { id: messageId } });

        if (!message) {
            return res.status(404).json({ error: "Message not found" });
        }

        // Allow admins to delete any message
        if (message.userId.toString() !== userId.toString() && !userRoles.includes("admin")) {
            return res.status(403).json({ error: "You can only delete your own messages" });
        }

        await message.destroy();

        const io = req.app.get("io");
        io.emit("message_deleted", { id: messageId });

        res.json({ success: true, message: "Message deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete message" });
    }
});




module.exports = router;