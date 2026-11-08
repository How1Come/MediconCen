import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdentityMappings1794096000000 implements MigrationInterface {
  name = 'CreateIdentityMappings1794096000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`identity_mappings\` (
        \`userID\` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        \`id1\` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
        \`id2\` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
        PRIMARY KEY (\`userID\`),
        UNIQUE INDEX \`UQ_identity_mappings_id1_id2\` (\`id1\`, \`id2\`)
      ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `identity_mappings`');
  }
}
