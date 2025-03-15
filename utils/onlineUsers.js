const onlineUsers = {}; // Stores userId -> { username, socketId }

module.exports = {
    getUsers: () => onlineUsers,

    addUser: (userId, username, socketId) => {
        if (onlineUsers[userId]) {
            return false;
        }
        onlineUsers[userId] = { username, socketId };
        return true;
    },

    removeUser: (userId) => {
        if (onlineUsers[userId]) {
            delete onlineUsers[userId];
        }
    },

    getUserSocketId: (userId) => onlineUsers[userId]?.socketId || null,

    getAllUserIds: () => Object.keys(onlineUsers),

    getAllUsernames: () => Object.values(onlineUsers).map(user => user.username),
};