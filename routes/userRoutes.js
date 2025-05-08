import express from "express";
import {Punishment, Role, User} from "../models/models.js";
import {checkRole, validateInput, verifyTokenWithBlacklist} from "../middleware/authMiddleware.js";
import {body, param, query, validationResult} from "express-validator";
import bcrypt from "bcryptjs";
import {Op} from "sequelize";

const router = express.Router();

router.get('/list', verifyTokenWithBlacklist, checkRole(["user"]),[
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
    query('search').optional().trim().escape()
], async (req, res) => {
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

        // Check if current user is admin
        const isAdmin = req.user.roles.includes('admin');

        const users = rows.map(user => {
            const userData = {
                id: user.id,
                username: user.username,
                gender: user.gender,
                birthdate: user.birthdate,
                createdAt: user.createdAt,
                roles: user.Roles.map(role => role.name)
            };
            if (isAdmin) {
                userData.email = user.email;
            }
            return userData;
        });

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
});

router.get('/:id', verifyTokenWithBlacklist, checkRole(["user"]), [
    param('id').isInt({ min: 1 }).withMessage('Invalid user ID')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ message: 'Invalid user ID', errors: errors.array() });
    }

    try {
        const userId = parseInt(req.params.id);
        const requestingUserId = req.user.id;
        const isAdmin = req.user.roles.includes('admin');

        const user = await User.findByPk(userId, {
            attributes: [
                'id',
                'username',
                'email',
                'gender',
                'birthdate',
                'createdAt',
                'enabled',
                'forumMessagesCount',
                'chatMessagesCount'
            ],
            include: [
                {
                    model: Role,
                    attributes: ['name'],
                    through: { attributes: [] }
                },
                {
                    model: Punishment,
                    as: 'punishments',
                    attributes: ['type', 'expiresAt', 'reason', 'createdAt'],
                    where: {
                        [Op.or]: [
                            { expiresAt: { [Op.gt]: new Date() } },
                            { expiresAt: null }
                        ]
                    },
                    required: false,
                    include: [{
                        model: User,
                        as: 'issuedBy',
                        attributes: ['username']
                    }]
                }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Process punishments data
        const activePunishments = user.punishments || [];
        const isBanned = activePunishments.some(p => p.type === 'ban');
        const isMuted = activePunishments.some(p => p.type === 'mute');
        const banInfo = activePunishments.find(p => p.type === 'ban');
        const muteInfo = activePunishments.find(p => p.type === 'mute');

        const profileData = {
            id: user.id,
            username: user.username,
            gender: user.gender,
            birthdate: user.birthdate,
            createdAt: user.createdAt,
            roles: user.Roles.map(role => role.name),
            enabled: user.enabled,
            forumMessagesCount: user.forumMessagesCount || 0,
            chatMessagesCount: user.chatMessagesCount || 0,
            isBanned,
            isMuted,
            banInfo: banInfo ? {
                expiresAt: banInfo.expiresAt,
                reason: banInfo.reason,
                issuedAt: banInfo.createdAt,
                issuedBy: banInfo.issuedBy?.username || 'System'
            } : null,
            muteInfo: muteInfo ? {
                expiresAt: muteInfo.expiresAt,
                reason: muteInfo.reason,
                issuedAt: muteInfo.createdAt,
                issuedBy: muteInfo.issuedBy?.username || 'System'
            } : null
        };

        // Only include email if viewing own profile or admin
        if (userId == requestingUserId || isAdmin) {
            profileData.email = user.email;
        }

        res.json(profileData);
    } catch (error) {
        console.error('Error retrieving user profile:', error);
        res.status(500).json({
            message: 'Error retrieving user profile',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

router.post("/change-password", verifyTokenWithBlacklist, validateInput([
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

            user.password = await bcrypt.hash(newPassword, 10);
            await user.save();

            res.json({ message: "Password changed successfully" });
        } catch (error) {
            res.status(500).json({ message: "Internal server error", error: error.message });
        }
    }
);

export default router;