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

// Define Relationship
Punishment.belongsTo(User, { foreignKey: "userId" });
User.hasMany(Punishment, { foreignKey: "userId" });


sequelize.sync({alter:false});

module.exports = { sequelize, User, Role, UserRole, Message, Punishment };
