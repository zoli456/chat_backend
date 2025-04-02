import express from "express";
import { Forum, Subforum, Topic, Post, User } from "../models/models.js";
import { verifyToken, checkRole, validate } from "../middleware/authMiddleware.js";
import { param, check, body, query } from "express-validator";
import {validateAndSanitizeContent} from "../middleware/MessageFilter.js";
import req from "express/lib/request.js";

const router = express.Router();

// Get all forum categories with subforums
router.get("/categories", verifyToken,async (req, res) => {
    try {
        const forums = await Forum.findAll({
            include: [
                {
                    model: Subforum,
                    as: "subforums",
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

router.get("/topics/:subforumId", verifyToken ,validate([
    param("subforumId").isInt().withMessage("Invalid subforum ID")]),
    async (req, res) => {
        try {
            const topics = await Topic.findAll({
                where: { subforumId: req.params.subforumId },
                include: [{ model: User, attributes: ["username"] }],
                order: [["createdAt", "DESC"]],
            });

            res.json(
                topics.map((topic) => ({
                    id: topic.id,
                    title: topic.title,
                    author: topic.User.username,
                    createdAt: topic.createdAt,
                }))
            );
        } catch (err) {
            res.status(500).json({ error: "Error fetching topics" });
        }
    }
);

router.get("/topics/:topicId/posts", verifyToken, validate([
    param("topicId").isInt().withMessage("Invalid topic ID"),
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
    query("limit").optional().isInt({ min: 1, max: 30}).withMessage("Limit must be a positive integer")
]), async (req, res) => {
    try {
        const { topicId } = req.params;
        let { page, limit } = req.query;

        page = parseInt(page) || 1;
        limit = parseInt(limit) || 30;
        const offset = (page - 1) * limit;

        const topic = await Topic.findByPk(topicId);
        if (!topic) return res.status(404).json({ error: "Topic not found." });

        const totalPosts = await Post.count({ where: { topicId } });

        const posts = await Post.findAll({
            where: { topicId },
            include: { model: User, attributes: ["id", "username"] },
            order: [["createdAt", "ASC"]],
            limit,
            offset,
        });

        res.json({
            topic,
            posts: posts || [],
            totalPosts,
            totalPages: Math.ceil(totalPosts / limit),
            currentPage: page
        });
    } catch (error) {
        console.error("Error fetching posts:", error);
        res.status(500).json({ error: "Error fetching posts.", posts: [] });
    }
});


router.post("/categories", verifyToken, checkRole(["admin"]), validate([
    check("name").isLength({ min: 3, max: 50 }).trim().escape().withMessage("Category name must be between 3 and 50 characters.")]),
    async (req, res) => {
        try {
            const forum = await Forum.create({ name: req.body.name });
            res.status(201).json({ id: forum.id, name: forum.name, subforums: [] });
        } catch (err) {
            res.status(400).json({ error: "Error creating forum" });
        }
    }
);

router.post("/subforums/:subforumId/topics", verifyToken, validate([
    param("subforumId").isInt().withMessage("Invalid subforum ID"),
    check("title").isLength({ min: 3, max: 50 }).trim().escape().withMessage("Topic name must be between 3 and 50 characters.")]),
    async (req, res) => {
        try {
            const { subforumId } = req.params;
            const { title } = req.body;
            const topic = await Topic.create({ title, userId: req.user.id, subforumId });
            res.status(201).json(topic);
        } catch (error) {
            res.status(400).json({ error: "Error creating topic." });
        }
    }
);

router.post("/topics/:topicId/posts", verifyToken, [
        param("topicId").isInt().withMessage("Invalid topic ID."),
        body("content")
            .trim()
            .custom((value) => {
                const validation = validateAndSanitizeContent(value);

                if (validation.hasDisallowedTags) {
                    throw new Error("Post contains disallowed HTML tags.");
                }
                if (validation.isEmpty) {
                    throw new Error("Post content cannot be empty.");
                }
                if (validation.textLength < 3 || validation.textLength > 512) {
                    throw new Error("Post content must be between 3 and 512 characters (excluding HTML tags).");
                }

                // Store the sanitized content for later use
                req.sanitizedContent = validation.sanitized;
                return true;
            })
            .isString().escape(),
    ],
    async (req, res) => {
        try {
            const { topicId } = req.params;
            const content = req.sanitizedContent;

            const post = await Post.create({
                content,
                userId: req.user.id,
                topicId
            });

            const postWithUser = {
                ...post.toJSON(),
                User: { id: req.user.id, username: req.user.username }
            };

            res.status(201).json(postWithUser);

            const io = req.app.get("io");
            io.to(topicId.toString()).emit("newPost", postWithUser);
        } catch (error) {
            console.error("Error creating post:", error);
            res.status(400).json({ error: error.message || "Error creating post." });
        }
    }
);
router.post("/categories/:forumId/subforums", verifyToken, checkRole(["admin"]) ,validate([
    param("forumId").isInt().withMessage("Invalid forum ID"),
    check("name").isLength({ min: 3, max: 50 }).trim().escape().withMessage("Subforum name must be between 3 and 50 characters."),
    check("description").isLength({ min: 3, max: 100 }).trim().escape().withMessage("Description must be between 3 and 100 characters.")]),
    async (req, res) => {
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
    }
);

router.put("/categories/:categoryId", verifyToken, checkRole(["admin"]),
    validate([
        param("categoryId").isInt().withMessage("Invalid category ID."),
        body("name")
            .trim()
            .isLength({ min: 3, max: 50 })
            .withMessage("Category name must be between 3 and 50 characters."),]),
    async (req, res) => {
        try {
            const { categoryId } = req.params;
            const { name } = req.body;
            const category = await Forum.findByPk(categoryId);
            if (!category) return res.status(404).json({ error: "Category not found." });

            await category.update({ name });
            const updatedCategory = await Forum.findByPk(categoryId, {
                include: { model: Subforum, as: "subforums" },
            });
            res.status(200).json(updatedCategory);
        } catch (err) {
            console.error(err);
            res.status(400).json({ error: "Error updating category." });
        }
    }
);


router.put("/categories/:forumId/subforums/:subforumId", verifyToken, checkRole(["admin"]),
    validate([
        param("forumId").isInt().withMessage("Invalid forum ID."),
        param("subforumId").isInt().withMessage("Invalid subforum ID."),
        body("name")
            .trim()
            .isLength({ min: 3, max: 50 })
            .withMessage("Subforum name must be between 3 and 50 characters."),
        body("description")
            .trim()
            .isLength({ min: 3, max: 100 })
            .withMessage("Description must be between 3 and 100 characters."),
    ]),
    async (req, res) => {
        try {
            const { subforumId } = req.params;
            const { name, description } = req.body;
            const subforum = await Subforum.findByPk(subforumId);
            if (!subforum) return res.status(404).json({ error: "Subforum not found." });

            await subforum.update({ name, description });
            const updatedSubforum = await Subforum.findByPk(subforumId, {
                include: { model: Forum, as: "forum" },
            });
            res.status(200).json(updatedSubforum);
        } catch (err) {
            console.error(err);
            res.status(400).json({ error: "Error updating subforum." });
        }
    }
);

router.put("/posts/:postId", verifyToken, checkRole(["user"]), [
        param("postId").isInt().withMessage("Invalid post ID."),
        body("content")
            .trim()
            .custom((value) => {
                const validation = validateAndSanitizeContent(value);

                if (validation.hasDisallowedTags) {
                    throw new Error("Post contains disallowed HTML tags.");
                }
                if (validation.isEmpty) {
                    throw new Error("Post content cannot be empty.");
                }
                if (validation.textLength < 3 || validation.textLength > 512) {
                    throw new Error("Post content must be between 3 and 512 characters (excluding HTML tags).");
                }

                // Store the sanitized content for later use
                req.sanitizedContent = validation.sanitized;
                return true;
            })
            .isString().escape(),
    ],
    async (req, res) => {
        try {
            const { postId } = req.params;
            const content = req.sanitizedContent; // Use the sanitized content

            const post = await Post.findByPk(postId);
            if (!post) return res.status(404).json({ error: "Post not found." });

            if (post.userId !== req.user.id && !req.user.roles.includes("admin")) {
                return res.status(403).json({ error: "Unauthorized to edit this post." });
            }

            await post.update({ content });
            const updatedPost = {
                ...post.toJSON(),
                User: {
                    id: req.user.id,
                    username: req.user.username,
                },
            };

            res.status(200).json(updatedPost);

            const io = req.app.get("io");
            io.to(post.topicId.toString()).emit("updatePost", { updatedPost });
        } catch (error) {
            console.error("Error updating post:", error);
            res.status(400).json({ error: error.message || "Error updating post." });
        }
    }
);

router.put("/topics/:topicId", verifyToken, checkRole(["user"]),
    validate([
        param("topicId").isInt().withMessage("Invalid topic ID."),
        body("title")
            .trim()
            .isLength({ min: 3, max: 50 })
            .withMessage("Topic title must be between 3 and 50 characters."),
    ]),
    async (req, res) => {
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
    }
);

router.delete("/categories/:forumId/subforums/:subforumId",
    verifyToken,
    checkRole(["admin"]),
    validate([
        param("forumId").isInt().withMessage("Invalid forum ID"),
        param("subforumId").isInt().withMessage("Invalid subforum ID")
    ]),
    async (req, res) => {
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

router.delete("/categories/:categoryId",
    verifyToken,
    checkRole(["admin"]),
    validate([
        param("categoryId").isInt().withMessage("Invalid category ID")
    ]),
    async (req, res) => {
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

router.delete("/posts/:postId", verifyToken, checkRole(["user"]), validate([
        param("postId").isInt().withMessage("Invalid post ID")
    ]),
    async (req, res) => {
        try {
            const { postId } = req.params;
            const post = await Post.findByPk(postId);
            if (!post) return res.status(404).json({ error: "Post not found." });
            if (post.userId !== req.user.id && !req.user.roles.includes("admin")) {
                return res.status(403).json({ error: "Unauthorized to delete this post." });
            }
            await post.destroy();
            res.status(200).json({ message: "Post deleted successfully." });
            const io = req.app.get("io");
            io.to(post.topicId.toString()).emit("deletePost", postId);
        } catch (error) {
            console.error("Error deleting post:", error);
            res.status(400).json({ error: "Error deleting post." });
        }
    });

router.delete("/topics/:topicId",
    verifyToken,
    checkRole(["user"]),
    validate([
        param("topicId").isInt().withMessage("Invalid topic ID")
    ]),
    async (req, res) => {
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

export default router;