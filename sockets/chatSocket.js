const jwt = require("jsonwebtoken");
const onlineUsers = require("../utils/onlineUsers");
const { Punishment } = require("../models");
const { FilterMessage } = require("../middleware/FilterProfanity");

module.exports = (io) => {
    io.on("connection", (socket) => {
        const token = socket.handshake.auth?.token;
        if (!token) {
            console.log("No token provided, disconnecting socket.");
            return socket.disconnect();
        }

        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                console.log("Invalid token, disconnecting socket.");
                return socket.disconnect();
            }

            const userId = decoded.id;
            const username = decoded.username;

            // Check if user is already connected
            const existingSocketId = onlineUsers.getUserSocketId(userId);
            if (existingSocketId) {
                console.log(`User ${userId} already connected. Forcing logout from previous session.`);
                io.to(existingSocketId).emit("force_logout");
                io.sockets.sockets.get(existingSocketId)?.disconnect(true);
                await new Promise(resolve => setTimeout(resolve, 100)); // Ensure disconnection is processed
            }

            // Add the new connection
            onlineUsers.addUser(userId, username, socket.id);
            io.emit("update_users", onlineUsers.getAllUsernames());
            console.log(`User ${username} (ID: ${userId}) connected.`);

            try {
                const mute = await Punishment.findOne({ where: { userId, type: "mute" } });
                if (mute) {
                    console.log(`User ${userId} is muted.`);
                    socket.emit("user_muted", { userId:userId, reason: mute.reason, expiresAt: mute.expiresAt });
                }
            } catch (error) {
                console.error("Error checking mute status:", error);
            }

            socket.on("message", (msg) => {
                io.emit("message", FilterMessage(msg));
            });

            socket.on("disconnect", () => {
                console.log(`User ${username} (ID: ${userId}) disconnected.`);
                onlineUsers.removeUser(userId);
                io.emit("update_users", onlineUsers.getAllUsernames());
            });
        });
    });
};
