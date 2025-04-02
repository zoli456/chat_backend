import express from "express";
import { DMessage, User } from "../models/models.js";
import { verifyToken, validate } from "../middleware/authMiddleware.js";
import { check, param } from "express-validator";
import { getUserSocketId } from "../utils/onlineUsers.js";
import { validateAndSanitizeContent} from "../middleware/MessageFilter.js";
import req from "express/lib/request.js";

const router = express.Router();

router.get("/:type", verifyToken, validate([
        param("type")
            .isIn(["incoming", "outgoing"])
            .withMessage("Invalid message type. Use 'incoming' or 'outgoing'.")]),
    async (req, res) => {
        try {
            const { type } = req.params;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;

            let whereCondition = {};
            let includeOptions = [];
            let count, messages;

            if (type === "incoming") {
                whereCondition = { recipientId: req.user.id };
                includeOptions = [{ model: User, as: "Sender", attributes: ["id", "username"] }];
            } else if (type === "outgoing") {
                whereCondition = { senderId: req.user.id };
                includeOptions = [{ model: User, as: "Recipient", attributes: ["id", "username"] }];
            } else {
                return res.status(400).json({ error: "Invalid message type. Use 'incoming' or 'outgoing'." });
            }

            count = await DMessage.count({ where: whereCondition });
            messages = await DMessage.findAll({
                where: whereCondition,
                attributes: ["id", "subject", "viewed", "senderId", "recipientId", "createdAt"],
                include: includeOptions,
                order: [["createdAt", "DESC"]],
                limit,
                offset
            });

            const totalPages = Math.ceil(count / limit);

            res.json({
                messages,
                currentPage: page,
                totalPages,
                totalItems: count,
                itemsPerPage: limit
            });
        } catch (error) {
            console.error("Error fetching messages:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    });

router.get("/message/:id", verifyToken, validate([
    param("id").isInt().withMessage("Invalid message ID."),
]), async (req, res) => {
    try {
        const { id } = req.params;
        const message = await DMessage.findByPk(id, {
            include: [
                { model: User, as: "Sender", attributes: ["id", "username"] },
                { model: User, as: "Recipient", attributes: ["id", "username"] }
            ]
        });

        if (!message) {
            return res.status(404).json({ error: "Message not found." });
        }

        if (message.senderId !== req.user.id && message.recipientId !== req.user.id) {
            return res.status(403).json({ error: "Unauthorized to view this message." });
        }

        if (message.recipientId === req.user.id && !message.viewed) {
            message.viewed = true;
            await message.save();
        }

        res.json(message);
    } catch (error) {
        console.error("Error fetching message:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/", verifyToken, validate([
        check("recipient")
            .trim()
            .notEmpty().withMessage("Recipient is required.")
            .isString().escape(),
        check("subject")
            .trim()
            .isLength({ min: 3, max: 100 })
            .withMessage("Subject must be between 3 and 100 characters.")
            .isString().escape(),
        check("content")
            .trim()
            .custom((value) => {
                const validation = validateAndSanitizeContent(value);

                if (validation.hasDisallowedTags) {
                    throw new Error("Message contains disallowed HTML tags.");
                }
                if (validation.isEmpty) {
                    throw new Error("Message content cannot be empty.");
                }
                if (validation.textLength < 3 || validation.textLength > 1000) {
                    throw new Error("Message content must be between 3 and 1000 characters (excluding HTML tags).");
                }

                req.sanitizedContent = validation.sanitized;
                return true;
            })
            .isString().escape(),
    ]), async (req, res) => {
        const { recipient, subject } = req.body;
        const content = req.sanitizedContent;

        try {
            const sender = await User.findByPk(req.user.id);
            const recipientUser = await User.findOne({ where: { username: recipient } });

            if (!recipientUser) {
                return res.status(404).json({ error: "Recipient not found." });
            }
            if (sender.id === recipientUser.id) {
                return res.status(400).json({ error: "You cannot send messages to yourself." });
            }

            const message = await DMessage.create({
                subject,
                content,
                senderId: sender.id,
                recipientId: recipientUser.id,
                viewed: false
            });

            // Fetch the message with sender information to send via socket
            const messageWithSender = await DMessage.findByPk(message.id, {
                include: [
                    {
                        model: User,
                        as: "Sender",
                        attributes: ["id", "username"]
                    }
                ],
                attributes: ["id", "subject", "viewed", "senderId", "recipientId", "createdAt"]
            });

            const io = req.app.get("io");
            const targetSocketId = getUserSocketId(recipientUser.id);

            if (targetSocketId) {
                io.to(targetSocketId).emit("newDirectMessage", messageWithSender);
            }

            res.status(201).json(message);
        } catch (error) {
            console.error("Error sending message:", error);
            res.status(500).json({ error: "Internal server error." });
        }
    }
);
router.delete("/:id", verifyToken, validate([
    param("id").isInt().withMessage("Invalid message ID."),
]), async (req, res) => {
    try {
        const { id } = req.params;
        const message = await DMessage.findByPk(id);

        if (!message) {
            return res.status(404).json({ error: "Message not found." });
        }

        if (message.senderId !== req.user.id && message.recipientId !== req.user.id) {
            return res.status(403).json({ error: "Unauthorized to delete this message." });
        }

        await message.destroy();

        const io = req.app.get("io");
        let targetSocketId = getUserSocketId(message.senderId);
        if (targetSocketId) {
            io.to(targetSocketId).emit("directMessageDeleted", {deletedMessageId: id});
        }

        targetSocketId = getUserSocketId(message.recipientId);
        if (targetSocketId) {
            io.to(targetSocketId).emit("directMessageDeleted", id);
        }
        res.json({ message: "Message deleted successfully." });
    } catch (error) {
        console.error("Error deleting message:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/:id/view", verifyToken, validate([
    param("id")
        .isInt().withMessage("Invalid message ID."),
]), async (req, res) => {
    try {
        const { id } = req.params;
        const message = await DMessage.findByPk(id);

        if (!message) {
            return res.status(404).json({ error: "Message not found." });
        }

        if (message.recipientId !== req.user.id) {
            return res.status(403).json({ error: "Unauthorized to mark as viewed." });
        }

        message.viewed = true;
        await message.save();

        res.json({ message: "Message marked as viewed." });
    } catch (error) {
        console.error("Error marking message as viewed:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
