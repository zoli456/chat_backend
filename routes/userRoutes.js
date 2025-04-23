import express from "express";
import { User, Role } from "../models/models.js";
import {validate, verifyToken, verifyTokenWithBlacklist} from "../middleware/authMiddleware.js";
import {body, param, query, validationResult} from "express-validator";
import bcrypt from "bcryptjs";
import {Op} from "sequelize";

const router = express.Router();

router.get('/list', verifyToken, [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('search').optional().trim().escape()
],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Invalid query parameters', errors: errors.array() });
        }

        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;
            const search = req.query.search || '';
            const offset = (page - 1) * limit;

            let whereClause = {};
            if (search) {
                whereClause = {
                    [Op.or]: [
                        { username: { [Op.like]: `%${search}%` } },
                        { email: { [Op.like]: `%${search}%` } }
                    ]
                };
            }

            const { count, rows } = await User.findAndCountAll({
                where: whereClause,
                attributes: ['id', 'username', 'email', 'gender', 'birthdate', 'createdAt'],
                include: {
                    model: Role,
                    attributes: ['name'],
                    through: { attributes: [] }
                },
                limit,
                offset,
                order: [['username', 'ASC']],
                distinct: true
            });

            const totalPages = Math.ceil(count / limit);
            const users = rows.map(user => ({
                id: user.id,
                username: user.username,
                email: user.email,
                gender: user.gender,
                birthdate: user.birthdate,
                createdAt: user.createdAt,
                roles: user.Roles.map(role => role.name)
            }));

            res.json({
                users,
                totalPages,
                currentPage: page,
                totalUsers: count
            });
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ message: 'Error fetching users', error: error.message });
        }
    }
);

router.get('/:id', verifyTokenWithBlacklist, [
        param('id').isInt({ min: 1 }).withMessage('Invalid user ID')
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: 'Invalid user ID', errors: errors.array() });
        }

        try {
            const userId = parseInt(req.params.id);
            const requestingUserId = req.user.id;

            const user = await User.findByPk(userId, {
                include: {
                    model: Role,
                    attributes: ['name'],
                    through: { attributes: [] }
                }
            });

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const profileData = {
                id: user.id,
                username: user.username,
                gender: user.gender,
                birthdate: user.birthdate,
                createdAt: user.createdAt,
                roles: user.Roles.map(role => role.name)
            };

            if (userId === requestingUserId) {
                profileData.email = user.email;
            }

            res.json(profileData);
        } catch (error) {
            res.status(500).json({ message: 'Error retrieving user profile', error: error.message });
        }
    }
);

router.post("/change-password", verifyTokenWithBlacklist, validate([
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