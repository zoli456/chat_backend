const jwt = require("jsonwebtoken");
const { User, Role, Punishment, UserRole} = require("../models");
const {Op} = require("sequelize");

const verifyToken = (req, res, next) => {
    const token = req.header("Authorization");
    if (!token) return res.status(401).json({ error: "Access denied" });

    try {
        req.user = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
        next();
    } catch (error) {
        res.status(400).json({ error: "Invalid token" });
    }
};

const checkRole = (roles = []) => {
    if (!Array.isArray(roles) || roles.length === 0) {
        throw new Error("checkRole must be called with an array of roles.");
    }

    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.id) {
                return res.status(403).json({ error: "Access denied" });
            }

            // Fetch user with roles from the database
            const user = await User.findByPk(req.user.id, {
                include: {
                    model: Role,
                    attributes: ["name"],
                    through: { attributes: [] },
                },
            });

            if (!user || !user.Roles || user.Roles.length === 0) {
                return res.status(403).json({ error: "User has no roles assigned." });
            }

            // Extract role names
            const userRoles = user.Roles.map(role => role.name);
            req.user.roles = userRoles; // Attach roles to request

            // Check if user has required role
            const hasRole = roles.some(role => userRoles.includes(role));
            if (!hasRole) {
                return res.status(403).json({ error: "Insufficient permissions" });
            }

            next();
        } catch (error) {
            console.error("Role check error:", error);
            return res.status(500).json({ error: "Internal server error" });
        }
    };
};

const checkBanStatus = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const activeBan = await Punishment.findOne({
            where: {
                userId: user.id,
                type: 'ban',
                expiresAt: { [Op.or]: [null, { [Op.gt]: new Date() }] }, // Permanent or active ban
            },
        });

        if (activeBan) {
            const banEnd = activeBan.expiresAt
                ? ` Your ban ends on ${new Date(activeBan.expiresAt).toLocaleString()}`
                : ' This ban is permanent.';

            return res.status(403).json({
                error: `You are banned. Reason: ${activeBan.reason}.${banEnd}`,
            });
        }

        next();
    } catch (error) {
        console.error('Error checking ban status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = { verifyToken, checkRole, checkBanStatus };
