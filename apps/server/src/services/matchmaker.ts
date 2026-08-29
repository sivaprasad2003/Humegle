import { redis } from './redis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

const MATCH_SCRIPT = `
local targetQueue = KEYS[1]
local myQueue = KEYS[2]
local mySessionId = ARGV[1]
local timestamp = ARGV[2]

local match = redis.call('ZRANGE', targetQueue, 0, 0)
if match and #match > 0 then
    local matchedSessionId = match[1]
    redis.call('ZREM', targetQueue, matchedSessionId)
    return matchedSessionId
else
    redis.call('ZADD', myQueue, timestamp, mySessionId)
    return nil
end
`;

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'ANY';

export class Matchmaker {
  static async findMatch(sessionId: string, myGender: Gender, interest: Gender): Promise<{ roomId: string, partnerId: string } | null> {
    const myQueue = `queue:${myGender}:${interest}`;
    const targetQueue = `queue:${interest}:${myGender}`;
    
    const actualTargetQueue = interest === 'ANY' ? `queue:ANY:ANY` : targetQueue;
    const actualMyQueue = interest === 'ANY' ? `queue:ANY:ANY` : myQueue;

    try {
      const partnerId = await redis.eval(
        MATCH_SCRIPT,
        2,
        actualTargetQueue,
        actualMyQueue,
        sessionId,
        Date.now().toString()
      ) as string | null;

      if (partnerId) {
        const roomId = uuidv4();
        await redis.set(`room:${roomId}`, JSON.stringify({ user1: sessionId, user2: partnerId }), 'EX', 86400);
        await redis.set(`session_room:${sessionId}`, roomId, 'EX', 86400);
        await redis.set(`session_room:${partnerId}`, roomId, 'EX', 86400);
        
        logger.info({ roomId, sessionId, partnerId }, 'Match created successfully');
        return { roomId, partnerId };
      }
      return null;
    } catch (error) {
      logger.error({ error, sessionId }, 'Matchmaking error');
      throw new Error('Matchmaking failed');
    }
  }

  static async removeFromQueue(sessionId: string, myGender: Gender, interest: Gender) {
    const myQueue = `queue:${myGender}:${interest}`;
    await redis.zrem(myQueue, sessionId);
  }
}
