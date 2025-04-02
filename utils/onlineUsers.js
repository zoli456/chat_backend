const onlineUsers = {};

const getUsers = () => onlineUsers;

const addUser = (userId, username, socketId) => {
    if (onlineUsers[userId]) {
        return false;
    }
    onlineUsers[userId] = { username, socketId };
    return true;
};

export const removeUser = (userId) => {
    if (onlineUsers[userId]) {
        delete onlineUsers[userId];
    }
};

export const getUserSocketId = (userId) => onlineUsers[userId]?.socketId || null;

const getAllUserIds = () => Object.keys(onlineUsers);

const getAllUsernames = () => Object.values(onlineUsers).map(user => user.username);

export default { getUsers, addUser, removeUser, getUserSocketId, getAllUserIds, getAllUsernames };
