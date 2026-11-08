import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isDuplicateKeyError } from '../database/database-errors';
import { IdentityRepository } from './identity.repository';

@Injectable()
export class IdentityService {
  constructor(private readonly identities: IdentityRepository) {}

  async resolve(id1: string, id2: string): Promise<{ userID: string }> {
    const existing = await this.identities.findByPair(id1, id2);

    if (existing) {
      return { userID: existing.userID };
    }

    const userID = randomUUID();

    try {
      await this.identities.insert({ id1, id2, userID });

      return { userID };
    } catch (error: unknown) {
      if (isDuplicateKeyError(error)) {
        const winner = await this.identities.findByPair(id1, id2);

        if (winner) {
          return { userID: winner.userID };
        }
      }

      throw error;
    }
  }
}
