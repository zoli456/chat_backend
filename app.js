const express = require("express");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const { sequelize, Role} = require("./models");
const authRoutes = require("./routes/authRoutes");
const messageRoutes = require("./routes/messageRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const dmessageRoutes = require("./routes/dmessageRoutes");
const chatSocket = require("./sockets/chatSocket");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

const seedRoles = async () => {
  await sequelize.sync();
  await Role.findOrCreate({ where: { name: "user" } });
  await Role.findOrCreate({ where: { name: "admin" } });
  console.log("Roles seeded.");
  process.exit();
};

app.set("io", io);
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dmessages", dmessageRoutes);

chatSocket(io);

//seedRoles();

server.listen(5000, () => console.log("Server running on port 5000"));