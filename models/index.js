const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASS, {
    host: process.env.DB_HOST,
    dialect: "mariadb",
    logging: false,
});

// User Model
const User = sequelize.define("User", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false },
    gender: {
        type: DataTypes.ENUM("Male", "Female"),
        allowNull: false
    },
    birthdate: { type: DataTypes.DATEONLY, allowNull: false }
});

// Role Model
const Role = sequelize.define("Role", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// UserRole (Intermediate Table)
const UserRole = sequelize.define("UserRole", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true }
});

// Define Relationships
User.belongsToMany(Role, { through: UserRole, foreignKey: "userId" });
Role.belongsToMany(User, { through: UserRole, foreignKey: "roleId" });

// Message Model
const Message = sequelize.define("Message", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    text: { type: DataTypes.STRING(512), allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
});

Message.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Message, { foreignKey: "userId" });

// Punishment Model
const Punishment = sequelize.define("Punishment", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" }
    },
    type: {
        type: DataTypes.ENUM("mute", "ban"),
        allowNull: false
    },
    reason: { type: DataTypes.STRING(512), allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    createdAt: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
});
Punishment.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Punishment, { foreignKey: "userId" });

const DMessage = sequelize.define("DMessage", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subject: { type: DataTypes.STRING(100), allowNull: false },
    content: { type: DataTypes.STRING(2048), allowNull: false },
    viewed: { type: DataTypes.BOOLEAN, defaultValue: false }, // New field to track message read status
    senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE" // Delete messages if sender is deleted
    },
    recipientId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE" // Delete messages if recipient is deleted
    },
});

DMessage.belongsTo(User, { as: "Sender", foreignKey: "senderId", onDelete: "CASCADE" });
DMessage.belongsTo(User, { as: "Recipient", foreignKey: "recipientId", onDelete: "CASCADE" });
User.hasMany(DMessage, { foreignKey: "senderId", as: "SentMessages" });
User.hasMany(DMessage, { foreignKey: "recipientId", as: "ReceivedMessages" });

// Forum Model
const Forum = sequelize.define("Forum", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// Subforum Model
const Subforum = sequelize.define("Subforum", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.STRING, allowNull: true },
    forumId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Forum, key: "id" } }
});

Forum.hasMany(Subforum, { foreignKey: "forumId", as: "subforums", onDelete: "CASCADE" });
Subforum.belongsTo(Forum, { foreignKey: "forumId", as: "forum" });

// Topic Model
const Topic = sequelize.define("Topic", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: "id" } },
    subforumId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Subforum, key: "id" } }
});

Subforum.hasMany(Topic, { foreignKey: "subforumId", onDelete: "CASCADE" });
Topic.belongsTo(Subforum, { foreignKey: "subforumId" });
Topic.belongsTo(User, { foreignKey: "userId" });

const Post = sequelize.define("Post", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    content: { type: DataTypes.TEXT, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: User, key: "id" } },
    topicId: { type: DataTypes.INTEGER, allowNull: false, references: { model: Topic, key: "id" } },
});

Topic.hasMany(Post, { foreignKey: "topicId", onDelete: "CASCADE" });
Post.belongsTo(Topic, { foreignKey: "topicId" });
Post.belongsTo(User, { foreignKey: "userId" });

// Sync the Database
sequelize.sync({ alter: false, force: false });

module.exports = { sequelize, User,Message, Role, UserRole,DMessage,Punishment, Forum, Subforum, Topic, Post };