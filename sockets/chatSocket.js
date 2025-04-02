import jwt from "jsonwebtoken";
import onlineUsers from "../utils/onlineUsers.js";
import {Punishment, UserToken} from "../models/models.js";
import {Op} from "sequelize";

const socketHandler = (io) => {
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
            try {
                const tokenRecord = await UserToken.findOne({
                    where: {
                        token,
                        isValid: true,
                        expiresAt: { [Op.gt]: new Date() }
                    }
                });

                if (!tokenRecord) {
                    console.log("Invalid or expired token, disconnecting socket.");
                    return socket.disconnect();
                }

                const userId = decoded.id;
                const username = decoded.username;
                const existingSocketId = onlineUsers.getUserSocketId(userId);
                if (existingSocketId) {
                    console.log(`User ${userId} already connected. Forcing logout from previous session.`);
                    io.to(existingSocketId).emit("force_logout", {userId});
                    io.sockets.sockets.get(existingSocketId)?.disconnect(true);
                    await new Promise(resolve => setTimeout(resolve, 100)); // Ensure disconnection is processed
                }
                onlineUsers.addUser(userId, username, socket.id);
                socket.on("chat_typing", (username) => {
                    socket.broadcast.emit("chat_typing", username);
                });
                socket.on("entered_chat", async (msg) => {
                    io.emit("chat_update_users", onlineUsers.getAllUsernames());
                    try {
                        const mute = await Punishment.findOne({where: {userId, type: "mute"}});
                        if (mute) {
                            socket.emit("notify_user_muted", {
                                userId: userId,
                                reason: mute.reason,
                                expiresAt: mute.expiresAt
                            });
                        }
                    } catch (error) {
                        console.error("Error checking mute status:", error);
                    }
                });
                console.log(`User ${username} (ID: ${userId}) connected.`);

                socket.on("joinTopic", (topicId) => {
                    console.log(`User ${username} joined topic ${topicId}`);
                    socket.join(topicId);
                });

                socket.on("leaveTopic", (topicId) => {
                    console.log(`User ${username} left topic ${topicId}`);
                    socket.leave(topicId);
                });

                socket.on("disconnect", () => {
                    console.log(`User ${username} (ID: ${userId}) disconnected.`);
                    onlineUsers.removeUser(userId);
                    io.emit("chat_update_users", onlineUsers.getAllUsernames());
                });
            } catch (error) {
                console.error("Token verification error:", error);
                socket.disconnect();
            }
        });
    })
}

export default socketHandler;