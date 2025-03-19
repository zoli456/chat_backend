const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { User, Role, Punishment} = require("../models");
const rateLimit = require("express-rate-limit");
const onlineUsers = require("../utils/onlineUsers");
const { Op } = require("sequelize");

const router = express.Router();
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 1000,
    message: { error: "Too many login attempts. Please try again later." },
    headers: true,
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 1000,
    message: { error: "Too many registration attempts. Please try again later." },
    headers: true,
});

router.post("/register",registerLimiter, [
    body("username").isLength({ min: 3 }).withMessage("Username must be at least 3 characters long"),
    body("email").isEmail().withMessage("Invalid email format"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters long"),
    body("confirmPassword").custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error("Passwords do not match");
        }
        return true;
    }),
    body("gender").isIn(["Male", "Female"]).withMessage("Invalid gender selection"),
    body("birthdate").isISO8601().withMessage("Invalid birthdate format (YYYY-MM-DD)")
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { username, email, password, gender, birthdate } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({ username, email, password: hashedPassword, gender, birthdate });

        const defaultRole = await Role.findOrCreate({ where: { name: "user" } });
        await user.addRole(defaultRole[0]);

        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(400).json({ error: "Registration failed" });
    }
});

router.post("/login", loginLimiter,[
    body("username").notEmpty().withMessage("Username is required"),
    body("password").notEmpty().withMessage("Password is required"),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const { username, password } = req.body;
        const user = await User.findOne({
            where: { username },
            include: Role
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (onlineUsers.getUserSocketId(user.id)) {
            return res.status(403).json({ error: "You are already logged in from another device." });
        }

        const activeBan = await Punishment.findOne({
            where: {
                userId: user.id,
                type: "ban",
                expiresAt: { [Op.or]: [null, { [Op.gt]: new Date() }] },
            }
        });

        if (activeBan) {
            const banEnd = activeBan.expiresAt
                ? ` Your ban ends on ${new Date(activeBan.expiresAt).toLocaleString()}`
                : " This ban is permanent.";

            return res.status(403).json({
                error: `You are banned. Reason: ${activeBan.reason}.${banEnd}`
            });
        }

        const roles = user.Roles.map(role => role.name);
        const token = jwt.sign({ username: user.username, id: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        res.json({ token, roles });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Login failed" });
    }
});

module.exports = router;