const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { createClient } = require("redis");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const crypto = require("crypto"); // Required for signature verification
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- Configuration ---
const MONGO_ATLAS_URI = process.env.MONGO_ATLAS_URI;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const REDIS_URL = process.env.REDIS_URL;
const PUBLIC_URL = process.env.PUBLIC_URL || "http://localhost:5173";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Must add this to your .env file

let db;
let redisClient;

// --- Middleware ---

// 1. JSON Parser with Raw Body Capture (Needed for GitHub Signature Verification)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(cookieParser());

// 2. Authentication Middleware
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

// 3. GitHub Webhook Signature Verification Middleware
const verifyGithubSignature = (req, res, next) => {
  const signature = req.headers["x-hub-signature-256"];

  if (!WEBHOOK_SECRET) {
    console.warn("⚠️ WEBHOOK_SECRET is not set in .env. Skipping verification (UNSAFE).");
    return next();
  }

  if (!signature) {
    console.warn("❌ Missing X-Hub-Signature-256 header.");
    return res.status(401).send("No signature found.");
  }

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(req.rawBody).digest("hex");

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return next();
  } else {
    console.error("❌ Invalid Webhook Signature.");
    return res.status(401).send("Invalid signature.");
  }
};

// --- Auth Routes ---

app.get("/api/auth/github", (req, res) => {
  const redirectURI = `${PUBLIC_URL}/api/auth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo user:email&redirect_uri=${redirectURI}`;
  res.redirect(url);
});

app.get("/api/auth/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) return res.status(400).send("Error: No code provided");

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) throw new Error("Failed to get access token");

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

    const result = await db.collection("users").findOneAndUpdate(
      { githubId: githubUser.id },
      { $set: userPayload },
      { upsert: true, returnDocument: "after" }
    );

    const user = result || result.value; // Handle difference in Mongo driver versions

    console.log(`User ${user.username} logged in.`);

    const sessionToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("auth_token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.redirect(`${PUBLIC_URL}/dashboard`);
  } catch (error) {
    console.error("Auth Callback Error:", error.message);
    res.status(500).send("Authentication failed");
  }
});

app.get("/api/auth/me", (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).send({ message: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.send({ userId: payload.userId, username: payload.username });
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("auth_token");
  res.status(200).send({ message: "Logged out successfully" });
});

// --- Repository Routes ---

app.get("/api/repositories", protectRoute, async (req, res) => {
  try {
    const repos = await db
      .collection("repositories")
      .find({ userId: req.user.userId })
      .toArray();
    res.status(200).send(repos);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.post("/api/repositories", protectRoute, async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) return res.status(400).send({ message: "Repository URL is required." });

  try {
    const urlParts = new URL(repo_url);
    let fullName = urlParts.pathname
      .replace(/^\//, "")
      .replace(/\/$/, "")
      .replace(/\.git$/, "");

    // Check for duplicates
    const existingRepo = await db.collection("repositories").findOne({
      full_name: { $regex: new RegExp(`^${fullName}$`, "i") },
      userId: req.user.userId,
    });

    if (existingRepo) return res.status(409).send({ message: "Repository already added." });

    // Validate Permissions via GitHub API
    const userDoc = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
    if (!userDoc?.accessToken) return res.status(401).send({ message: "GitHub token missing." });

    try {
      const ghResponse = await axios.get(`https://api.github.com/repos/${fullName}`, {
        headers: { Authorization: `token ${userDoc.accessToken}` },
      });
      
      const permissions = ghResponse.data.permissions;
      if (!permissions || (!permissions.admin && !permissions.push)) {
        return res.status(403).send({ message: "You need admin or write access." });
      }
    } catch (ghError) {
      if (ghError.response?.status === 404) return res.status(404).send({ message: "Repo not found or private." });
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
    res.status(201).send({ message: "Repository added successfully.", data: repository });
  } catch (error) {
    console.error("Add Repo Error:", error.message);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/repositories/:id", protectRoute, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

  try {
    const repo = await db.collection("repositories").findOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });

    if (!repo) return res.status(404).send({ message: "Repository not found" });

    const reviews = await db
      .collection("reviews")
      .find({ repo_name: repo.full_name, userId: req.user.userId })
      .sort({ analyzed_at: -1 })
      .toArray();

    res.send({ ...repo, reviews });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.delete("/api/repositories/:id", protectRoute, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

  try {
    const result = await db.collection("repositories").deleteOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });

    if (result.deletedCount === 0) return res.status(404).send({ message: "Repo not found." });
    res.status(200).send({ message: "Repository deleted." });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// --- Dashboard & Reviews Routes ---

app.get("/api/dashboard/stats", protectRoute, async (req, res) => {
  try {
    const totalRepos = await db.collection("repositories").countDocuments({ userId: req.user.userId });
    
    const reviewStats = await db.collection("reviews").aggregate([
        { $match: { userId: req.user.userId } },
        { $group: { _id: null, totalReviews: { $sum: 1 }, totalIssues: { $sum: "$issues_found" } } },
    ]).toArray();

    const stats = reviewStats[0] || { totalReviews: 0, totalIssues: 0 };

    const chartDataRaw = await db.collection("reviews").aggregate([
        { $match: { userId: req.user.userId } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$analyzed_at" } }, prs: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: 30 },
    ]).toArray();

    const chartData = chartDataRaw.map((item) => ({ date: item._id, prs: item.prs }));

    res.send({
      totalRepos,
      totalReviews: stats.totalReviews,
      totalIssues: stats.totalIssues,
      chartData,
    });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/dashboard/reviews", protectRoute, async (req, res) => {
  try {
    const recentReviews = await db.collection("reviews")
      .find({ userId: req.user.userId })
      .sort({ analyzed_at: -1 })
      .limit(10)
      .toArray();
    res.send(recentReviews);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/api/reviews/:id", protectRoute, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

  try {
    const review = await db.collection("reviews").findOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });
    if (!review) return res.status(404).send({ message: "Review not found" });
    res.send(review);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// --- Webhook & Analysis Triggers ---

// Secure Webhook Endpoint (Signature Verified)
app.post("/api/webhook", verifyGithubSignature, async (req, res) => {
  const githubEvent = req.headers["x-github-event"];
  const action = req.body.action;

  console.log(`Webhook Event: ${githubEvent} | Action: ${action}`);

  if (githubEvent === "pull_request" && (action === "opened" || action === "synchronize")) {
    try {
      const jobData = {
        eventType: githubEvent,
        payload: req.body,
        timestamp: Date.now(),
      };
      
      await redisClient.lPush("pr_queue", JSON.stringify(jobData));
      console.log(`✅ Job queued for ${req.body.repository?.full_name}`);
      res.status(202).send("Accepted and queued.");
    } catch (error) {
      console.error("Queue Error:", error);
      res.status(500).send("Internal Server Error.");
    }
  } else if (githubEvent === "ping") {
    res.status(200).send("Pong!");
  } else {
    res.status(200).send("Event ignored.");
  }
});

// Manual Analysis Trigger (Dashboard Button)
app.post("/api/repositories/:id/analyze", protectRoute, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid ID" });

  try {
    const repo = await db.collection("repositories").findOne({
      _id: new ObjectId(id),
      userId: req.user.userId,
    });

    if (!repo) return res.status(404).send({ message: "Repository not found" });

    const jobData = {
      eventType: "repository_analysis",
      payload: {
        repo_id: id,
        repo_name: repo.full_name,
        clone_url: repo.url,
      },
    };

    await redisClient.lPush("pr_queue", JSON.stringify(jobData));
    console.log(`Manual analysis queued for ${repo.full_name}`);
    res.status(202).send({ message: "Analysis started." });
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});

// --- Server Startup ---

const startServer = async () => {
  try {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => console.log("Redis Client Error", err));
    await redisClient.connect();
    console.log("✅ Successfully connected to Redis!");

    const mongoClient = new MongoClient(MONGO_ATLAS_URI);
    await mongoClient.connect();
    db = mongoClient.db("code-reviewer-ai-db");
    console.log("✅ Successfully connected to MongoDB Atlas!");

    app.listen(PORT, () => {
      console.log(`🚀 Ingestion service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to database or start server", error);
    process.exit(1);
  }
};

startServer();
