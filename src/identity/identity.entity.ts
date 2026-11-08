import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('identity_mappings')
@Index('UQ_identity_mappings_id1_id2', ['id1', 'id2'], { unique: true })
export class IdentityMapping {
  @PrimaryColumn({
    type: 'char',
    length: 36,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  userID!: string;

  @Column({
    type: 'varchar',
    length: 255,
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_bin',
  })
  id1!: string;

  @Column({
    type: 'varchar',
    length: 255,
    charset: 'utf8mb4',
    collation: 'utf8mb4_0900_bin',
  })
  id2!: string;
}
