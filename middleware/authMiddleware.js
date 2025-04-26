import jwt from "jsonwebtoken";
import {User, Role, Punishment, UserToken} from "../models/models.js";
import {Op} from "sequelize";
import {validationResult} from "express-validator";

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
                expiresAt: { [Op.or]: [null, { [Op.gt]: new Date() }] },
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

const validateInput = (validations) => {
    return async (req, res, next) => {
        await Promise.all(validations.map(validation => validation.run(req)));
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    };
};

const checkMuteStatus = async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const activeMute = await Punishment.findOne({
            where: {
                userId: user.id,
                type: 'mute',
                expiresAt: { [Op.or]: [null, { [Op.gt]: new Date() }] },
            },
        });

        if (activeMute) {
            const muteEnd = activeMute.expiresAt
                ? ` Your mute ends on ${new Date(activeMute.expiresAt).toLocaleString()}.`
                : ' This mute is permanent.';

            return res.status(403).json({
                error: `You are muted. Reason: ${activeMute.reason}.${muteEnd}`,
            });
        }

        next();
    } catch (error) {
        console.error('Error checking mute status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const verifyTokenWithBlacklist = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

    try {
        const tokenRecord = await UserToken.findOne({
            where: {
                token,
                isValid: true,
                expiresAt: { [Op.gt]: new Date() }
            }
        });

        if (!tokenRecord) return res.status(401).json({ error: "Invalid or expired token" });

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) return res.status(401).json({ error: "Invalid token" });
            req.user = decoded;
            req.tokenRecord = tokenRecord; // Attach token record to request
            next();
        });
    } catch (error) {
        console.error("Token verification error:", error);
        res.status(500).json({ error: "Token verification failed" });
    }
};

export { checkMuteStatus, checkRole, checkBanStatus, validateInput, verifyTokenWithBlacklist };