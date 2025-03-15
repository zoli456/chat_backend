const express = require("express");
const { User, Role } = require("../models");
const {verifyToken, checkRole} = require("../middleware/authMiddleware");
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
            updatedAt: user.updatedAt
        });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving user data', error: error.message });
    }
});

module.exports = router;
