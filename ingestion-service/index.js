const axios = require('axios');
const cookieParser = require('cookie-parser');
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const { createClient } = require('redis');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_ATLAS_URI = process.env.MONGO_ATLAS_URI;
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

let db;

app.use(express.json());
app.use(cookieParser());

const protectRoute = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send({ message: "Not Authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
};

app.get('/api/auth/github', (req, res) => {
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo user:email`;
  res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('Error: No code provided');
  }

  try {
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      },
      {
        headers: { Accept: 'application/json' },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    if (!accessToken) {
      throw new Error('Failed to get access token');
    }

    const userResponse = await axios.get('https://api.github.com/user', {
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

    const result = await db.collection('users').findOneAndUpdate(
      { githubId: githubUser.id },
      { $set: userPayload },
      { upsert: true, returnDocument: 'after' }
    );

    const user = result;
    console.log(`User ${user.username} logged in.`);

    const sessionToken = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('auth_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.redirect('http://localhost:5173/dashboard');
  } catch (error) {
    console.error('Auth callback error:', error.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).send({ message: "Not Authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.send({ userId: payload.userId, username: payload.username });
  } catch (error) {
    res.status(401).send({ message: "Invalid token" });
  }
});

app.post('/api/repositories', protectRoute, async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) {
    return res.status(400).send({ message: 'Repository URL is required.' })
  }

  try {
    const urlParts = new URL(repo_url);
    const fullName = urlParts.pathname.slice(1);

    const repository = {
      userId: req.user.userId,
      full_name: fullName,
      url: repo_url,
      status: 'active',
      added_at: new Date(),
      last_checked_at: null,
    };

    const result = await db.collection('repositories').updateOne(
      { full_name: fullName, userId: req.user.userId },
      { $set: repository },
      { upsert: true }
    );

    const newRepo = await db.collection('repositories').findOne({ full_name: fullName, userId: req.user.userId });

    console.log(`User ${req.user.username} added/updated repository: ${fullName}`);
    res.status(201).send({ message: 'Repository added successfully.', data: newRepo });
  } catch (error) {
    console.error('Failed to add repository:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});

app.get('/api/repositories', protectRoute, async (req, res) => {
  try {
    const repos = await db.collection('repositories').find({ userId: req.user.userId }).toArray();
    res.status(200).send(repos);
  } catch (error) {
    console.error('Failed to fetch repositories:', error);
    res.status(500).send({ message: 'Internal Server Error' });
  }
});

app.get('/', (req, res) => {
  res.send('Ingestion service is running and connected to Redis!');
});

app.post('/api/webhook', async (req, res) => {
  const githubEvent = req.headers['x-github-event'];
  console.log(`Webhook received! Event type: ${githubEvent}`);

  if (githubEvent === 'pull_request') {
    try {
      const jobData = {
        eventType: githubEvent,
        payload: req.body
      };

      await redisClient.lPush('pr_queue', JSON.stringify(jobData));
      console.log('Job pushed to Redis queue.');

      res.status(202).send('Accepted and queued for processing.');
    } catch (error) {
      console.error('Failed to queue job:', error);
      res.status(500).send('Internal Server Error.');
    }
  } else {
    res.status(200).send('Event received, but not processed.');
  }
});

app.get('/api/dashboard/stats', protectRoute, async (req, res) => {
  try {
    const totalRepos = await db.collection('repositories').countDocuments({
      userId: req.user.userId
    });

    const reviewStats = await db.collection('reviews').aggregate([
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          totalIssues: { $sum: "$issues_found" }
        }
      }
    ]).toArray();
    const stats = reviewStats[0] || { totalReviews: 0, totalIssues: 0 };

    res.send({
      totalRepos,
      totalReviews: stats.totalReviews,
      totalIssues: stats.totalIssues,
      linterErrors: Math.floor(stats.totalIssues * 0.8)
    });
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error);
    res.status(500).send({ message: "Internal Server Error" });
  }
})

app.get('/api/dashboard/reviews', protectRoute, async (req, res) => {
  try {
    const recentReviews = await db.collection('reviews')
      .find()
      .sort({ analyzed_at: -1 })
      .limit(10)
      .toArray();

    res.send(recentReviews);
  } catch (error) {
    console.error('Failed to fetch recent review:', error);
    res.status(500).send({ message: "Internal Server Error" });
  }
})

app.get('/api/reviews/:id', protectRoute, async (req, res) => {
  const { id } = req.params;

  try {
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid review ID" });
    }

    const review = await db.collection('reviews').findOne({
      _id: new ObjectId(id)
    });

    if (!review) {
      return res.status(404).send({ message: "Review not found" });
    }

    res.send(review);
  } catch (error) {
    console.error('Failed to fetch review details:', error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get('/api/reviews', protectRoute, async (req, res) => {
  try {
    const reviews = awaitdb.collection('reviews')
      .find()
      .sort({ analyzed_at: -1 })
      .toArray();

    res.send(reviews);
  } catch (error) {
    console.error('Failed to fetch review history:', error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.cookie('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(0),
    path: '/',
  });
  res.status(200).send({ message: 'Logged out successfully' });
});


const startServer = async () => {
  try {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.log('Redis Client Error', err));
    await redisClient.connect();
    console.log('Successfully connected to Redis!');

    const mongoClient = new MongoClient(MONGO_ATLAS_URI);
    await mongoClient.connect();
    db = mongoClient.db('code-reviewer-ai-db');
    console.log('Successfully connected to MongoDB Atlas!');

    app.listen(PORT, () => {
      console.log(`Ingestion service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to database or start server", error);
    process.exit(1);
  }
};

startServer();
