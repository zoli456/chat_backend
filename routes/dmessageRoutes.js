const express = require("express");
const { DMessage, User } = require("../models");
const { verifyToken, validate} = require("../middleware/authMiddleware");
const router = express.Router();
const { check, validationResult, param} = require("express-validator");
const {getUserSocketId} = require("../utils/onlineUsers");

router.get("/:type", verifyToken, validate([
    param("type")
        .isIn(["incoming", "outgoing"])
        .withMessage("Invalid message type. Use 'incoming' or 'outgoing'.")]),
    async (req, res) => {
    try {
        const { type } = req.params;
        let messages;

        if (type === "incoming") {
            messages = await DMessage.findAll({
                where: { recipientId: req.user.id },
                include: [{ model: User, as: "Sender", attributes: ["id", "username"] }],
                order: [["createdAt", "DESC"]],
            });
        } else if (type === "outgoing") {
            messages = await DMessage.findAll({
                where: { senderId: req.user.id },
                include: [{ model: User, as: "Recipient", attributes: ["id", "username"] }],
                order: [["createdAt", "DESC"]],
            });
        } else {
            return res.status(400).json({ error: "Invalid message type. Use 'incoming' or 'outgoing'." });
        }

        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
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
            .isLength({ min: 3, max: 2048 })
            .withMessage("Message content must be between 3 and 2048 characters.")
            .isString().escape(),
]), async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { recipient, subject, content } = req.body;
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
            });
            const io = req.app.get("io");
            const targetSocketId = getUserSocketId(recipientUser.id);
            if (targetSocketId) {
                io.to(targetSocketId).emit("newDM", {sender: req.user.username, subject });
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

module.exports = router;
