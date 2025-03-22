const express = require("express");
const { Forum, Subforum, Topic, Post, User } = require("../models");
const { verifyToken, checkRole } = require("../middleware/authMiddleware");
const router = express.Router();
const { Op } = require("sequelize");

// Get all forum categories with subforums
router.get("/categories", async (req, res) => {
    try {
        const forums = await Forum.findAll({
            include: [
                {
                    model: Subforum,
                    as: "subforums", // ✅ Use the alias defined in the model
                    include: [
                        {
                            model: Topic,
                            attributes: ["id", "title"],
                            include: [
                                {
                                    model: Post,
                                    attributes: ["id", "createdAt"],
                                    include: [{ model: User, attributes: ["username"] }],
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        const formattedForums = forums.map(forum => ({
            id: forum.id,
            name: forum.name,
            subforums: forum.subforums.map(subforum => {
                const allPosts = subforum.Topics.flatMap(topic =>
                    topic.Posts.map(post => ({ ...post.toJSON(), topicTitle: topic.title }))
                );
                const lastPost = allPosts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
                return {
                    id: subforum.id,
                    name: subforum.name,
                    description: subforum.description,
                    topicCount: subforum.Topics.length,
                    postCount: allPosts.length,
                    lastPost
                };
            })
        }));

        res.json(formattedForums);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error fetching forums" });
    }
});

router.post("/categories", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const forum = await Forum.create({ name: req.body.name });
        res.status(201).json({ id: forum.id, name: forum.name, subforums: [] });
    } catch (err) {
        res.status(400).json({ error: "Error creating forum" });
    }
});

router.get("/topics/:subforumId", async (req, res) => {
    try {
        const topics = await Topic.findAll({
            where: { subforumId: req.params.subforumId },
            include: [{ model: User, attributes: ["username"] }],
            order: [["createdAt", "DESC"]]
        });

        res.json(topics.map(topic => ({
            id: topic.id,
            title: topic.title,
            author: topic.User.username,
            createdAt: topic.createdAt
        })));
    } catch (err) {
        res.status(500).json({ error: "Error fetching topics" });
    }
});

router.post("/topics", verifyToken, async (req, res) => {
    try {
        const topic = await Topic.create({
            title: req.body.title,
            userId: req.user.id,
            subforumId: req.body.subforumId
        });
        res.status(201).json(topic);
    } catch (err) {
        res.status(400).json({ error: "Error creating topic" });
    }
});

router.post("/forums", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { name } = req.body;
        const forum = await Forum.create({ name });
        res.status(201).json(forum);
    } catch (error) {
        res.status(400).json({ error: "Error creating forum." });
    }
});

router.post("/forums/:forumId/subforums", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { forumId } = req.params;
        const { name, description } = req.body;
        const subforum = await Subforum.create({ forumId, name, description });
        res.status(201).json(subforum);
    } catch (error) {
        res.status(400).json({ error: "Error creating subforum." });
    }
});

router.post("/subforums/:subforumId/topics", verifyToken, async (req, res) => {
    try {
        const { subforumId } = req.params;
        const { title } = req.body;
        const topic = await Topic.create({ title, userId: req.user.id, subforumId });
        res.status(201).json(topic);
    } catch (error) {
        res.status(400).json({ error: "Error creating topic." });
    }
});

router.post("/topics/:topicId/posts", verifyToken, async (req, res) => {
    try {
        const { topicId } = req.params;
        const { content } = req.body;
        const post = await Post.create({ content, userId: req.user.id, topicId });
        res.status(201).json(post);
    } catch (error) {
        res.status(400).json({ error: "Error creating post." });
    }
});

router.get("/topics/:topicId/posts", async (req, res) => {
    try {
        const { topicId } = req.params;
        const topic = await Topic.findByPk(topicId);
        if (!topic) return res.status(404).json({ error: "Topic not found." });

        const posts = await Post.findAll({
            where: { topicId },
            include: { model: User, attributes: ["id", "username"] },
            order: [["createdAt", "ASC"]]
        });

        res.json({ topic, posts: posts || [] }); // Ensure `posts` is always an array
    } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Error fetching posts.", posts: [] }); // Always include `posts`
    }
});

router.put("/categories/:categoryId", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { categoryId } = req.params;
        const { name } = req.body;
        const category = await Forum.findByPk(categoryId);
        if (!category) return res.status(404).json({ error: "Category not found." });
        await category.update({ name });
        const updatedCategory = await Forum.findByPk(categoryId, {
            include: { model: Subforum, as: "subforums" }
        });
        res.status(200).json(updatedCategory);
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: "Error updating category." });
    }
});

router.post("/categories/:forumId/subforums", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { forumId } = req.params;
        const { name, description } = req.body;
        const forum = await Forum.findByPk(forumId);
        if (!forum) return res.status(404).json({ error: "Forum not found." });

        const subforum = await Subforum.create({ forumId, name, description });
        res.status(201).json(subforum);
    } catch (err) {
        res.status(400).json({ error: "Error creating subforum." });
    }
});

router.put("/categories/:forumId/subforums/:subforumId", verifyToken, checkRole(["admin"]),
    async (req, res) => {
        try {
            const { forumId, subforumId } = req.params;
            const { name, description } = req.body;
            const subforum = await Subforum.findByPk(subforumId);
            if (!subforum) return res.status(404).json({ error: "Subforum not found." });
            await subforum.update({ name, description });
            const updatedSubforum = await Subforum.findByPk(subforumId, {
                include: { model: Forum, as: "forum" }
            });
            res.status(200).json(updatedSubforum);
        } catch (err) {
            console.error(err);
            res.status(400).json({ error: "Error updating subforum." });
        }
    }
);

router.delete("/categories/:forumId/subforums/:subforumId", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { forumId, subforumId } = req.params;
        const subforum = await Subforum.findByPk(subforumId);

        if (!subforum) return res.status(404).json({ error: "Subforum not found." });

        await subforum.destroy();
        res.status(200).json({ message: "Subforum deleted successfully" });
    } catch (err) {
        res.status(400).json({ error: "Error deleting subforum." });
    }
});

router.delete("/categories/:categoryId", verifyToken, checkRole(["admin"]), async (req, res) => {
    try {
        const { categoryId } = req.params;
        const category = await Forum.findByPk(categoryId);

        if (!category) return res.status(404).json({ error: "Category not found." });

        await category.destroy();
        res.status(200).json({ message: "Category deleted successfully" });
    } catch (err) {
        res.status(400).json({ error: "Error deleting category." });
    }
});

router.put("/posts/:postId", verifyToken, checkRole(["user"]), async (req, res) => {
    try {
        const { postId } = req.params;
        const { content } = req.body;
        const post = await Post.findByPk(postId);
        if (!post) return res.status(404).json({ error: "Post not found." });
        if (post.userId !== req.user.id && !req.user.roles.includes("admin")) {
            return res.status(403).json({ error: "Unauthorized to edit this post." });
        }
        await post.update({ content });
        res.status(200).json(post);
    } catch (error) {
        console.error("Error updating post:", error);
        res.status(400).json({ error: "Error updating post." });
    }
});

router.delete("/posts/:postId", verifyToken, checkRole(["user"]), async (req, res) => {
    try {
        const { postId } = req.params;
        const post = await Post.findByPk(postId);
        if (!post) return res.status(404).json({ error: "Post not found." });
        if (post.userId !== req.user.id && !req.user.roles.includes("admin")) {
            return res.status(403).json({ error: "Unauthorized to delete this post." });
        }
        await post.destroy();
        res.status(200).json({ message: "Post deleted successfully." });
    } catch (error) {
        console.error("Error deleting post:", error);
        res.status(400).json({ error: "Error deleting post." });
    }
});

router.delete("/topics/:topicId", verifyToken, checkRole(["user"]), async (req, res) => {
    try {
        const { topicId } = req.params;
        const topic = await Topic.findByPk(topicId);
        if (!topic) return res.status(404).json({ error: "Topic not found." });
        if (req.user.roles.includes("admin") || req.user.id === topic.userId) {
            await topic.destroy();
            res.status(200).json({ message: "Topic deleted successfully" });
        } else {
            res.status(403).json({ error: "Unauthorized to delete this topic." });
        }
    } catch (err) {
        res.status(400).json({ error: "Error deleting topic." });
    }
});

router.put("/topics/:topicId", verifyToken, checkRole(["user"]), async (req, res) => {
    try {
        const { topicId } = req.params;
        const { title } = req.body;
        const topic = await Topic.findByPk(topicId);
        if (!topic) return res.status(404).json({ error: "Topic not found." });
        if (req.user.roles.includes("admin") || req.user.id === topic.userId) {
            await topic.update({ title });
            res.status(200).json({ message: "Topic updated successfully" });
        } else {
            res.status(403).json({ error: "Unauthorized to edit this topic." });
        }
    } catch (err) {
        res.status(400).json({ error: "Error updating topic." });
    }
});
module.exports = router;