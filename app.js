import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import {sequelize, Role, UserToken, Setting} from "./models/models.js";
import authRoutes from "./routes/authRoutes.js";
import messageRoutes from "./routes/chatMessageRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import dmessageRoutes from "./routes/dmessageRoutes.js";
import forumRoutes from "./routes/forumRoutes.js";
import chatSocket from "./sockets/chatSocket.js";
import settingsRoutes from "./routes/settingsRoutes.js";
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
app.use("/api/settings", settingsRoutes);

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

await seedRoles();
async function initializeSettings() {
  try {
    const count = await Setting.count();
    if (count === 0) {
      await Setting.bulkCreate([
        { name: 'loginEnabled', value: 'true' },
        { name: 'registrationEnabled', value: 'true' }
      ]);
      console.log('Default settings created');
    }
  } catch (error) {
    console.error('Failed to initialize settings:', error);
  }
}

await initializeSettings();

server.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));
