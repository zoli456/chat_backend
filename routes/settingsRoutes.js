import express from "express";
import {body, param} from "express-validator";
import {Punishment, Role, Setting, User, UserToken} from "../models/models.js";
import {checkRole, validateInput, verifyTokenWithBlacklist} from "../middleware/authMiddleware.js";
import onlineUsers, {getUserSocketId} from "../utils/onlineUsers.js";
import bcrypt from "bcrypt";

const router = express.Router();

// In your backend routes
router.get('/', verifyTokenWithBlacklist, checkRole(["admin"]), async (req, res) => {
    try {
        // Get all settings from database
        const settings = await Setting.findAll();

        // If no settings exist, create default ones
        if (settings.length === 0) {
            const defaultSettings = [
                { name: 'loginEnabled', value: 'true' },
                { name: 'registrationEnabled', value: 'true' }
            ];

            await Setting.bulkCreate(defaultSettings);
            return res.json(defaultSettings);
        }

        res.json(settings);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

router.put('/', verifyTokenWithBlacklist, checkRole(["admin"]), async (req, res) => {
    try {
        const settingsToUpdate = req.body;

        // Update each setting in the database
        const updatePromises = settingsToUpdate.map(async (setting) => {
            await Setting.update(
                { value: setting.value },
                { where: { name: setting.name } }
            );
        });

        await Promise.all(updatePromises);
        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});
export default router;