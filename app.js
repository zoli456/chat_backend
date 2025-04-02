import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import {sequelize, Role, UserToken} from "./models/models.js";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/chatMessageRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import dmessageRoutes from "./routes/dmessageRoutes.js";
import forumRoutes from "./routes/forumRoutes.js";
import chatSocket from "./sockets/chatSocket.js";
import {Op} from "sequelize";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { // Use 'Server' instead of 'socketIo'
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

const seedRoles = async () => {
  try {
    await sequelize.sync();
    await Role.findOrCreate({ where: { name: "user" } });
    await Role.findOrCreate({ where: { name: "admin" } });
    console.log("Roles seeded.");
  } catch (error) {
    console.error("Error seeding roles:", error);
  }
};

app.set("io", io);
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dmessages", dmessageRoutes);
app.use("/api/forum", forumRoutes);

chatSocket(io);

setInterval(async () => {
  try {
    // Delete expired tokens
    await UserToken.destroy({
      where: {
        expiresAt: { [Op.lt]: new Date() }
      }
    });

    // Also clean up invalid tokens older than 7 days
    await UserToken.destroy({
      where: {
        isValid: false,
        updatedAt: { [Op.lt]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    });
  } catch (error) {
    console.error("Error cleaning up tokens:", error);
  }
}, 3600000);

// seedRoles();

server.listen(5000, () => console.log("Server running on port 5000"));
