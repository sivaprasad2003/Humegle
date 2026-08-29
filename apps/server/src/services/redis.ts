import Redis from 'ioredis';

// Connects to the Docker Redis database you started earlier
export const redis = new Redis(process.env.REDIS_URL || 'redis://:Siva@10072003@localhost:6379');

redis.on('connect', () => console.log('✅ Redis connected successfully'));
redis.on('error', (err) => console.error('❌ Redis connection error:', err));