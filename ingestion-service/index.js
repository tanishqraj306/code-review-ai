
const express = require('express');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

const startServer = async () => {
  await redisClient.connect();
  console.log('Successfully connected to Redis!');

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

  app.listen(PORT, () => {
    console.log(`Ingestion service listening on port ${PORT}`);
  });
};

startServer();
