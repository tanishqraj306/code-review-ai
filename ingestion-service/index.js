const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { createClient } = require("redis");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const crypto = require("crypto"); // Built-in node module
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
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; 

let db;
let redisClient;

// --- Middleware ---

// 1. JSON Parser with Raw Body Capture (CRITICAL for Signature Verification)
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(cookieParser());

// 2. Auth Middleware
const protectRoute = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).send({ message: "Not authenticated" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; 
    next();
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
};

// 3. Webhook Security Middleware
const verifyGithubSignature = (req, res, next) => {
  const signature = req.headers["x-hub-signature-256"];

  // Skip if secret not set (Only for dev, risky in prod)
  if (!WEBHOOK_SECRET) {
    console.warn("⚠️ WEBHOOK_SECRET not set. Skipping signature verification.");
    return next();
  }

  if (!signature) return res.status(401).send("No signature found.");

  const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(req.rawBody).digest("hex");

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return next();
  } else {
    console.error("❌ Invalid Webhook Signature");
    return res.status(401).send("Invalid signature.");
  }
};

// --- Auth Routes ---

app.get("/api/auth/github", (req, res) => {
  // Request 'repo' scope to allow creating webhooks and cloning private code
  const redirectURI = `${PUBLIC_URL}/api/auth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo user:email&redirect_uri=${redirectURI}`;
  res.redirect(url);
});

app.get("/api/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Error: No code provided");

  try {
    // 1. Exchange Code for Token
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      { client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code },
      { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) throw new Error("Failed to get access token");

    // 2. Get User Details
    const userResponse = await axios.get("https://api.github.com/user", {
      headers: { Authorization: `token ${accessToken}` },
    });
    const githubUser = userResponse.data;

    // 3. Save User & Token to DB (Crucial for Private Repo Cloning)
    const userPayload = {
      githubId: githubUser.id,
      username: githubUser.login,
      avatarUrl: githubUser.avatar_url,
      accessToken: accessToken, // <--- SAVING TOKEN HERE
      lastLogin: new Date(),
    };

    const result = await db.collection("users").findOneAndUpdate(
      { githubId: githubUser.id },
      { $set: userPayload },
      { upsert: true, returnDocument: "after" }
    );
    
    const user = result || result.value; 

    // 4. Create Session
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
    console.error("Auth Failed:", error.message);
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
  res.status(200).send({ message: "Logged out" });
});

// --- Repository Management Routes ---

app.get("/api/repositories", protectRoute, async (req, res) => {
  try {
    const repos = await db.collection("repositories").find({ userId: req.user.userId }).toArray();
    res.status(200).send(repos);
  } catch (e) { res.status(500).send({ message: "Internal Error" }) }
});

app.post("/api/repositories", protectRoute, async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) return res.status(400).send({ message: "Repository URL is required." });

  try {
    const urlParts = new URL(repo_url);
    let fullName = urlParts.pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.git$/, "");

    // 1. Check for duplicate
    const existing = await db.collection("repositories").findOne({
      full_name: { $regex: new RegExp(`^${fullName}$`, "i") },
      userId: req.user.userId,
    });
    if (existing) return res.status(409).send({ message: "Repository already added." });

    // 2. Fetch User Token
    const userDoc = await db.collection("users").findOne({ _id: new ObjectId(req.user.userId) });
    if (!userDoc?.accessToken) return res.status(401).send({ message: "GitHub token missing." });

    // 3. Verify Permissions & Existence
    try {
      await axios.get(`https://api.github.com/repos/${fullName}`, {
        headers: { Authorization: `token ${userDoc.accessToken}` },
      });
    } catch (e) {
      return res.status(404).send({ message: "Repository not found or private (access denied)." });
    }

    // 4. AUTOMATION: Create Webhook on GitHub
    const webhookUrl = `${process.env.PUBLIC_URL}/api/webhook`; // Ensure this is reachable (e.g. ngrok or domain)
    if (WEBHOOK_SECRET) {
      try {
        console.log(`Attempting to auto-create webhook for ${fullName}...`);
        await axios.post(
          `https://api.github.com/repos/${fullName}/hooks`,
          {
            name: "web",
            active: true,
            events: ["pull_request", "push"],
            config: {
              url: webhookUrl,
              content_type: "json",
              secret: WEBHOOK_SECRET,
              insecure_ssl: "0"
            }
          },
          {
            headers: { Authorization: `token ${userDoc.accessToken}`, Accept: "application/vnd.github.v3+json" }
          }
        );
        console.log("✅ Webhook auto-created successfully.");
      } catch (webhookErr) {
        // If it fails (e.g., already exists), we log and proceed. We don't block the user.
        console.warn("⚠️ Webhook creation warning:", webhookErr.response?.data?.errors?.[0]?.message || webhookErr.message);
      }
    }

    // 5. Save to DB
    const repository = {
      userId: req.user.userId,
      full_name: fullName,
      url: repo_url,
      status: "active",
      added_at: new Date(),
    };
    await db.collection("repositories").insertOne(repository);

    // 6. Trigger Initial Analysis (Optional)
    const jobData = {
        eventType: "repository_analysis",
        payload: { repo_id: repository._id, repo_name: fullName, clone_url: repo_url }
    };
    await redisClient.lPush("pr_queue", JSON.stringify(jobData));

    res.status(201).send({ message: "Repository added and monitoring started!", data: repository });

  } catch (error) {
    console.error("Add Repo Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.delete("/api/repositories/:id", protectRoute, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ message: "Invalid ID" });
  try {
    const result = await db.collection("repositories").deleteOne({ _id: new ObjectId(req.params.id), userId: req.user.userId });
    if (result.deletedCount === 0) return res.status(404).send({ message: "Not found" });
    res.status(200).send({ message: "Deleted" });
  } catch (e) { res.status(500).send({ message: "Error" }) }
});

app.get("/api/repositories/:id", protectRoute, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ message: "Invalid ID" });
    try {
        const repo = await db.collection("repositories").findOne({ _id: new ObjectId(req.params.id), userId: req.user.userId });
        if (!repo) return res.status(404).send({ message: "Not found" });
        const reviews = await db.collection("reviews").find({ repo_name: repo.full_name, userId: req.user.userId }).sort({ analyzed_at: -1 }).toArray();
        res.send({ ...repo, reviews });
    } catch (e) { res.status(500).send({ message: "Error" }) }
});

// --- Dashboard Routes ---

app.get("/api/dashboard/stats", protectRoute, async (req, res) => {
  try {
    const totalRepos = await db.collection("repositories").countDocuments({ userId: req.user.userId });
    const stats = (await db.collection("reviews").aggregate([
        { $match: { userId: req.user.userId } },
        { $group: { _id: null, totalReviews: { $sum: 1 }, totalIssues: { $sum: "$issues_count" } } }
    ]).toArray())[0] || { totalReviews: 0, totalIssues: 0 };

    const chartData = await db.collection("reviews").aggregate([
        { $match: { userId: req.user.userId } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$analyzed_at" } }, prs: { $sum: 1 } } },
        { $sort: { _id: 1 } }, { $limit: 30 }
    ]).toArray();

    res.send({ totalRepos, totalReviews: stats.totalReviews, totalIssues: stats.totalIssues, chartData: chartData.map(i => ({ date: i._id, prs: i.prs })) });
  } catch (e) { res.status(500).send({ message: "Error" }) }
});

app.get("/api/dashboard/reviews", protectRoute, async (req, res) => {
    try {
        const reviews = await db.collection("reviews").find({ userId: req.user.userId }).sort({ analyzed_at: -1 }).limit(10).toArray();
        res.send(reviews);
    } catch (e) { res.status(500).send({ message: "Error" }) }
});

app.get("/api/reviews/:id", protectRoute, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ message: "Invalid ID" });
    try {
        const review = await db.collection("reviews").findOne({ _id: new ObjectId(req.params.id), userId: req.user.userId });
        if(!review) return res.status(404).send({message:"Not found"});
        res.send(review);
    } catch(e) { res.status(500).send({message:"Error"}) }
});

// --- Webhook & Trigger Routes ---

// Secure Webhook Endpoint
app.post("/api/webhook", verifyGithubSignature, async (req, res) => {
  const event = req.headers["x-github-event"];
  const action = req.body.action;

  console.log(`Webhook: ${event} (${action})`);

  if (event === "ping") return res.status(200).send("Pong!");

  if (event === "pull_request" && (action === "opened" || action === "synchronize")) {
    try {
      const jobData = { eventType: event, payload: req.body, timestamp: Date.now() };
      await redisClient.lPush("pr_queue", JSON.stringify(jobData));
      console.log(`✅ Queued PR #${req.body.number}`);
      res.status(202).send("Queued");
    } catch (e) {
      console.error("Redis Error:", e);
      res.status(500).send("Queue Error");
    }
  } else {
    res.status(200).send("Ignored");
  }
});

app.post("/api/repositories/:id/analyze", protectRoute, async (req, res) => {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ message: "Invalid ID" });
    try {
        const repo = await db.collection("repositories").findOne({ _id: new ObjectId(req.params.id), userId: req.user.userId });
        if (!repo) return res.status(404).send({ message: "Repo not found" });

        await redisClient.lPush("pr_queue", JSON.stringify({
            eventType: "repository_analysis",
            payload: { repo_id: req.params.id, repo_name: repo.full_name, clone_url: repo.url }
        }));
        res.status(202).send({ message: "Analysis started" });
    } catch (e) { res.status(500).send({ message: "Error" }) }
});

// --- Server Startup ---

const startServer = async () => {
  try {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on("error", (err) => console.log("Redis Client Error", err));
    await redisClient.connect();
    console.log("✅ Redis Connected");

    const mongoClient = new MongoClient(MONGO_ATLAS_URI);
    await mongoClient.connect();
    db = mongoClient.db("code-reviewer-ai-db");
    console.log("✅ MongoDB Connected");

    app.listen(PORT, () => console.log(`🚀 Ingestion Service running on port ${PORT}`));
  } catch (error) {
    console.error("Startup Failed:", error);
    process.exit(1);
  }
};

startServer();
