import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * Small cache abstraction. Uses Redis when REDIS_URL is set (shared between instances), otherwise a per-process
 * in-memory map. Used for: signed-in user lookups, OTPs, rate/usage counters, public catalog responses and
 * last-known driver locations.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis?: Redis;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly sweeper?: NodeJS.Timeout;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
      this.redis.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
      this.logger.log('Cache: Redis');
    } else {
      this.sweeper = setInterval(() => this.sweep(), 60_000);
      this.sweeper.unref();
      this.logger.warn('Cache: in-memory (set REDIS_URL to share cache between instances)');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const raw = await this.redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      }
      const entry = this.memory.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        this.memory.delete(key);
        return null;
      }
      return JSON.parse(entry.value) as T;
    } catch (e) {
      this.logger.warn(`get(${key}) failed: ${(e as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (this.redis) await this.redis.set(key, raw, 'EX', ttlSeconds);
      else this.memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
    } catch (e) {
      this.logger.warn(`set(${key}) failed: ${(e as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      if (this.redis) await this.redis.del(...keys);
      else keys.forEach((k) => this.memory.delete(k));
    } catch (e) {
      this.logger.warn(`del failed: ${(e as Error).message}`);
    }
  }

  /** Deletes every key that starts with `prefix` (used to invalidate a whole cached namespace). */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      if (this.redis) {
        let cursor = '0';
        do {
          const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
          cursor = next;
          if (keys.length) await this.redis.del(...keys);
        } while (cursor !== '0');
      } else {
        for (const k of this.memory.keys()) if (k.startsWith(prefix)) this.memory.delete(k);
      }
    } catch (e) {
      this.logger.warn(`delByPrefix(${prefix}) failed: ${(e as Error).message}`);
    }
  }

  /** Returns the cached value, or computes + stores it. */
  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await factory();
    if (fresh !== undefined && fresh !== null) await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.memory) if (v.expiresAt < now) this.memory.delete(k);
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}
