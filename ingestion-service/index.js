const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { createClient } = require("redis");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const MONGO_ATLAS_URI = process.env.MONGO_ATLAS_URI;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const REDIS_URL = process.env.REDIS_URL;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:5173";

let db;
let redisClient;

app.use(express.json());
app.use(cookieParser());

const protectRoute = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send({ message: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // Attach user payload { userId, username }
    next();
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
};

app.get("/api/auth/github", (req, res) => {
  const redirectURI = `${PUBLIC_URL}/api/auth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo user:email&redirect_uri=${redirectURI}`;
  res.redirect(url);
});

app.get("/api/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send("Error: No code provided");
  }

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } },
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error("Failed to get access token");
    }

    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });
    const githubUser = userResponse.data;

    const userPayload = {
      githubId: githubUser.id,
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      accessToken,
      lastLogin: new Date(),
    };

    const result = await db
      .collection("users")
      .findOneAndUpdate(
        { githubId: githubUser.id },
        { $set: userPayload },
        { upsert: true, returnDocument: "after" },
      );

    const user = result;

    if (!user) {
      throw new Error("Failed to find or create user in database.");
    }

    console.log(`User ${user.username} logged in.`);

    const sessionToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.cookie("auth_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.redirect(`${PUBLIC_URL}/dashboard`);
  } catch (error) {
    console.error("!!! AUTHENTICATION FAILED !!!");
    if (error.response) {
      console.error("GitHub API Error:", error.response.data);
    } else {
      console.error("Auth Callback Error:", error.message);
    }
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send({ message: "Not authenticated" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.send({ userId: payload.userId, username: payload.username });
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.cookie("auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: new Date(0),
    path: "/",
  });
  res.status(200).send({ message: "Logged out successfully" });
});

app.get("/api/repositories", protectRoute, async (req, res) => {
  try {
    const repos = await db
      .collection("repositories")
      .find({ userId: req.user.userId })
      .toArray();
    res.status(200).send(repos);
  } catch (error) {
    console.error("Failed to fetch repositories:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.post("/api/repositories", protectRoute, async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) {
    return res.status(400).send({ message: "Repository URL is required." });
  }

  try {
    const urlParts = new URL(repo_url);

    let fullName = urlParts.pathname
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replace(/\.git$/, "");

    console.log(`Checking for duplicate: ${fullName} (Case Insensitive)`);

    const existingRepo = await db.collection("repositories").findOne({
      full_name: { $regex: new RegExp(`^${fullName}$`, "i") },
      userId: req.user.userId,
    });

    if (existingRepo) {
      console.log("Duplicate found in DB!");
      return res
        .status(409)
        .send({ message: "You have already added this repository." });
    }

    const userDoc = await db.collection("users").findOne({
      _id: new ObjectId(req.user.userId),
    });

    if (!userDoc || !userDoc.accessToken) {
      return res
        .status(401)
        .send({ message: "User GitHub token not found. Please log in again." });
    }

    try {
      const ghResponse = await axios.get(
        `https://api.github.com/repos/${fullName}`,
        {
          headers: {
            Authorization: `token ${userDoc.accessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        },
      );

      const permissions = ghResponse.data.permissions;

      if (!permissions || (!permissions.admin && !permissions.push)) {
        return res.status(403).send({
          message:
            "Permission denied. You must have admin or write access to the repository to add it.",
        });
      }
    } catch (ghError) {
      if (ghError.response && ghError.response.status === 404) {
        return res.status(404).send({
          message:
            "Repository not found on GitHub (or it is private and you lack access).",
        });
      }
      throw ghError;
    }

    const repository = {
      userId: req.user.userId,
      full_name: fullName,
      url: repo_url,
      status: "active",
      added_at: new Date(),
      last_checked_at: null,
    };

    await db.collection("repositories").insertOne(repository);

    console.log(`User ${req.user.username} added repository: ${fullName}`);
    res
      .status(201)
      .send({ message: "Repository added successfully.", data: repository });
  } catch (error) {
    console.error("Failed to add repository:", error.message);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/dashboard/stats", protectRoute, async (req, res) => {
  try {
    const totalRepos = await db.collection("repositories").countDocuments({
      userId: req.user.userId,
    });

    const reviewStats = await db
      .collection("reviews")
      .aggregate([
        { $match: { userId: req.user.userId } },
        {
          $group: {
            _id: null,
            totalReviews: { $sum: 1 },
            totalIssues: { $sum: "$issues_found" },
          },
        },
      ])
      .toArray();

    const stats = reviewStats[0] || { totalReviews: 0, totalIssues: 0 };

    const chartDataRaw = await db
      .collection("reviews")
      .aggregate([
        { $match: { userId: req.user.userId } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$analyzed_at" },
            },
            prs: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 30 },
      ])
      .toArray();

    const chartData = chartDataRaw.map((item) => ({
      date: item._id,
      prs: item.prs,
    }));

    res.send({
      totalRepos,
      totalReviews: stats.totalReviews,
      totalIssues: stats.totalIssues,
      linterErrors: Math.floor(stats.totalIssues * 0.8),
      chartData,
    });
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/dashboard/reviews", protectRoute, async (req, res) => {
  try {
    const recentReviews = await db
      .collection("reviews")
      .find({ userId: req.user.userId })
      .sort({ analyzed_at: -1 })
      .limit(10)
      .toArray();
    res.send(recentReviews);
  } catch (error) {
    console.error("Failed to fetch recent reviews:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/reviews", protectRoute, async (req, res) => {
  try {
    const reviews = await db
      .collection("reviews")
      .find({ userId: req.user.userId })
      .sort({ analyzed_at: -1 })
      .toArray();
    res.send(reviews);
  } catch (error) {
    console.error("Failed to fetch review history:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/reviews/:id", protectRoute, async (req, res) => {
  const { id } = req.params;
  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid review ID" });
    }
    const review = await db.collection("reviews").findOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });
    if (!review) {
      return res.status(404).send({ message: "Review not found" });
    }
    res.send(review);
  } catch (error) {
    console.error("Failed to fetch review details:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/repositories:id", protectRoute, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid repository ID" });
  }

  try {
    const repo = await db.collection("repositories").findOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });

    if (!repo) {
      return res.status(404).send({ message: "Repository not found" });
    }

    const reviews = await db
      .collection("reviews")
      .find({
        repo_name: repo.full_name,
        userId: req.user.userId,
      })
      .sort({ analyzed_at: -1 })
      .toArray();

    res.send({ ...repo, reviews });
  } catch (error) {
    console.error("Failed to fetch repository details:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.post("/api/webhook", async (req, res) => {
  const githubEvent = req.headers["x-github-event"];
  console.log(`Webhook received! Event type: ${githubEvent}`);

  if (githubEvent === "pull_request") {
    try {
      const jobData = {
        eventType: githubEvent,
        payload: req.body,
      };
      await redisClient.lPush("pr_queue", JSON.stringify(jobData));
      console.log("Job pushed to Redis queue.");
      res.status(202).send("Accepted and queued for processing.");
    } catch (error) {
      console.error("Failed to queue job:", error);
      res.status(500).send("Internal Server Error.");
    }
  } else {
    res.status(200).send("Event received, but not processed.");
  }
});

app.delete("/api/repositories/:id", protectRoute, async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid repository ID" });
  }

  try {
    const result = await db.collection("repositories").deleteOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });

    if (result.deletedCount === 0) {
      return res
        .status(404)
        .send({ message: "Repository not found or access denied." });
    }

    res.status(200).send({ message: "Repository deleted successfully." });
  } catch (error) {
    console.error("Failed to delete repository:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

const startServer = async () => {
  try {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => console.log("Redis Client Error", err));
    await redisClient.connect();
    console.log("Successfully connected to Redis!");

    const mongoClient = new MongoClient(MONGO_ATLAS_URI);
    await mongoClient.connect();
    db = mongoClient.db("code-reviewer-ai-db");
    console.log("Successfully connected to MongoDB Atlas!");

    app.listen(PORT, () => {
      console.log(`Ingestion service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to database or start server", error);
    process.exit(1);
  }
};

startServer();
