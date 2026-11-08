import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdentityMapping } from './identity.entity';

@Injectable()
export class IdentityRepository {
  constructor(
    @InjectRepository(IdentityMapping)
    private readonly mappings: Repository<IdentityMapping>,
  ) {}

  findByPair(id1: string, id2: string): Promise<IdentityMapping | null> {
    return this.mappings.findOneBy({ id1, id2 });
  }

  async insert(
    mapping: Pick<IdentityMapping, 'id1' | 'id2' | 'userID'>,
  ): Promise<void> {
    await this.mappings.insert(mapping);
  }
}
