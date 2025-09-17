
const express = require('express');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_ATLAS_URI = process.env.MONGO_ATLAS_URI;

let db;

app.use(express.json());

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
app.post('/api/repositories', async (req, res) => {
  const { repo_url } = req.body;
  if (!repo_url) {
    return res.status(400).send({ message: 'Repository URL is required.' })
  }

  try {
    const urlParts = new URL(repo_url);
    const fullName = urlParts.pathname.slice(1);

    const repository = {
      full_name: fullName,
      url: repo_url,
      status: 'active',
      added_at: new Date(),
      last_checked_at: null,
    };

    const result = await db.collection('repositories').updateOne(
      { full_name: fullName },
      { $set: repository },
      { upsert: true }
    );

    console.log(`Successfully added/updated repository: ${fullName}`);
    res.status(201).send({ message: 'Repository added successfully.', data: repository });
  } catch (error) {
    console.error('Failed to add repository:', error);
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


const startServer = async () => {
  try {
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
