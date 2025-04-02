import express from "express";
import { User, Role } from "../models/models.js";
import { verifyToken, checkRole, validate } from "../middleware/authMiddleware.js";
import { body, validationResult } from "express-validator";
import bcrypt from "bcryptjs";

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            include: { model: Role, attributes: ['name'] }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            roles: user.Roles.map(role => role.name),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            gender: user.gender,
            birthdate : user.birthdate
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user data', error: error.message });
    }
});

router.post("/change-password", verifyToken, validate([
        body("oldPassword")
            .trim()
            .notEmpty()
            .withMessage("Old password is required")
            .isString()
            .escape(),
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
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        try {
            const { oldPassword, newPassword } = req.body;
            const user = await User.findByPk(req.user.id);

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            const isMatch = await bcrypt.compare(oldPassword, user.password);
            if (!isMatch) {
                return res.status(400).json({ message: "Old password is incorrect" });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            user.password = hashedPassword;
            await user.save();

            res.json({ message: "Password changed successfully" });
        } catch (error) {
            res.status(500).json({ message: "Internal server error", error: error.message });
        }
    }
);

export default router;