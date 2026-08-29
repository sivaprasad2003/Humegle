import { redis } from './redis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'ANY';

export interface UserMeta {
  sessionId: string;
  gender: Gender;
  preferredGender: Gender;
  language: string;   // e.g. 'en', 'hi', '' means any
  country: string;    // e.g. 'IN', 'US', '' means any
  mode: string;       // 'video' | 'text'
  timestamp: number;
}

const WAITING_QUEUE = 'waiting_queue'; // sorted set: score = timestamp, member = sessionId
const META_PREFIX = 'meta:';           // hash key per session

/**
 * Returns true if the two users are gender-compatible.
 * Priority order (handled by caller via scoring):
 *   1. A prefers B's gender AND B prefers A's gender  (mutual opposite preference)
 *   2. At least one of them is ANY
 */
function genderCompatible(a: UserMeta, b: UserMeta): boolean {
  const aWantsB =
    a.preferredGender === 'ANY' || a.preferredGender === b.gender;
  const bWantsA =
    b.preferredGender === 'ANY' || b.preferredGender === a.gender;
  return aWantsB && bWantsA;
}

/**
 * Compute a match score (higher = better). Returns -1 if not compatible at all.
 */
function matchScore(me: UserMeta, candidate: UserMeta): number {
  // Language: strict — if both specify a language they must match
  const meHasLang = me.language !== '';
  const candidateHasLang = candidate.language !== '';
  if (meHasLang && candidateHasLang && me.language !== candidate.language) {
    return -1; // incompatible language
  }

  // Gender compatibility is required
  if (!genderCompatible(me, candidate)) {
    return -1;
  }

  let score = 0;

  // Mutual opposite-gender preference → highest gender bonus
  const mutualOpposite =
    me.preferredGender !== 'ANY' &&
    candidate.preferredGender !== 'ANY' &&
    me.preferredGender === candidate.gender &&
    candidate.preferredGender === me.gender;
  if (mutualOpposite) score += 100;

  // Language match bonus
  if (meHasLang && candidateHasLang && me.language === candidate.language) {
    score += 50;
  } else if (!meHasLang && !candidateHasLang) {
    score += 10; // both don't care — neutral
  }

  // Country bonus (soft — preferred but not required)
  const meHasCountry = me.country !== '';
  const candidateHasCountry = candidate.country !== '';
  if (meHasCountry && candidateHasCountry && me.country === candidate.country) {
    score += 30;
  }

  return score;
}

export class Matchmaker {
  /**
   * Try to find the best available match for `me`.
   * Atomically removes the winner from the waiting queue.
   * If no match found, adds `me` to the waiting queue.
   */
  static async findMatch(me: UserMeta): Promise<{ roomId: string; partnerId: string } | null> {
    try {
      // Store my metadata so candidates can read it
      await redis.hset(`${META_PREFIX}${me.sessionId}`, {
        sessionId: me.sessionId,
        gender: me.gender,
        preferredGender: me.preferredGender,
        language: me.language,
        country: me.country,
        mode: me.mode,
        timestamp: me.timestamp.toString(),
      });
      // Set TTL on meta so it doesn't leak
      await redis.expire(`${META_PREFIX}${me.sessionId}`, 3600);

      // Get all waiting candidates (oldest first, up to 200)
      const candidates = await redis.zrange(WAITING_QUEUE, '0', '199');

      let bestPartnerId: string | null = null;
      let bestScore = -1;

      for (const candidateId of candidates) {
        if (candidateId === me.sessionId) continue;

        const rawMeta = await redis.hgetall(`${META_PREFIX}${candidateId}`);
        if (!rawMeta || !rawMeta.sessionId) continue;

        const candidate: UserMeta = {
          sessionId: rawMeta.sessionId,
          gender: rawMeta.gender as Gender,
          preferredGender: rawMeta.preferredGender as Gender,
          language: rawMeta.language || '',
          country: rawMeta.country || '',
          mode: rawMeta.mode || 'video',
          timestamp: parseInt(rawMeta.timestamp || '0', 10),
        };

        const score = matchScore(me, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestPartnerId = candidateId;
        }
      }

      if (bestPartnerId !== null && bestScore >= 0) {
        // Atomically remove winner from waiting queue
        const removed = await redis.zrem(WAITING_QUEUE, bestPartnerId);
        if (removed === 0) {
          // Race condition: someone else grabbed them — add me to queue instead
          await redis.zadd(WAITING_QUEUE, me.timestamp, me.sessionId);
          return null;
        }

        // Clean up their meta (ours stays until we match or disconnect)
        await redis.del(`${META_PREFIX}${bestPartnerId}`);

        const roomId = uuidv4();
        await redis.set(
          `room:${roomId}`,
          JSON.stringify({ user1: me.sessionId, user2: bestPartnerId }),
          'EX', 86400,
        );
        await redis.set(`session_room:${me.sessionId}`, roomId, 'EX', 86400);
        await redis.set(`session_room:${bestPartnerId}`, roomId, 'EX', 86400);

        logger.info({ roomId, sessionId: me.sessionId, partnerId: bestPartnerId, score: bestScore }, 'Match created');
        return { roomId, partnerId: bestPartnerId };
      }

      // No match found — add me to waiting queue
      await redis.zadd(WAITING_QUEUE, me.timestamp, me.sessionId);
      return null;
    } catch (error) {
      logger.error({ error, sessionId: me.sessionId }, 'Matchmaking error');
      throw new Error('Matchmaking failed');
    }
  }

  /** Remove a session from the waiting queue and delete its meta. */
  static async removeFromQueue(sessionId: string) {
    await redis.zrem(WAITING_QUEUE, sessionId);
    await redis.del(`${META_PREFIX}${sessionId}`);
  }
}
