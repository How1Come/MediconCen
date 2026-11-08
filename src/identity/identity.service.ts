import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { IdentityCache } from '../cache/identity-cache.service';
import { isDuplicateKeyError } from '../database/database-errors';
import { IdentityRepository } from './identity.repository';

@Injectable()
export class IdentityService {
  constructor(
    private readonly identities: IdentityRepository,
    private readonly cache: IdentityCache,
  ) {}

  async resolve(id1: string, id2: string): Promise<{ userID: string }> {
    const cached = await this.cache.get(id1, id2);

    if (cached !== null) {
      return { userID: cached };
    }

    const userID = await this.resolveFromDatabase(id1, id2);
    await this.cache.set(id1, id2, userID);

    return { userID };
  }

  private async resolveFromDatabase(id1: string, id2: string): Promise<string> {
    const existing = await this.identities.findByPair(id1, id2);

    if (existing) {
      return existing.userID;
    }

    const userID = randomUUID();

    try {
      await this.identities.insert({ id1, id2, userID });

      return userID;
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        const winner = await this.identities.findByPair(id1, id2);

        if (winner) {
          return winner.userID;
        }
      }

      throw error;
    }
  }
}
