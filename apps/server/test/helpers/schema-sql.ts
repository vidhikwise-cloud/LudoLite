/**
 * SQLite DDL for the test database.
 *
 * Generated from prisma/schema.test.prisma, so it cannot drift by hand:
 *
 *   npm run test:schema --workspace apps/server
 *
 * Read at runtime rather than inlined, which keeps the generated SQL
 * reviewable as SQL in schema.sql.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, 'schema.sql'), 'utf8');

/**
 * Individual statements. Prisma emits one statement per block separated by
 * blank lines and `-- Comment` headers; splitting on `;` is safe here because
 * the generated DDL contains no semicolons inside string literals.
 */
export const TEST_SCHEMA_SQL: readonly string[] = sql
  .split(';')
  .map((s) =>
    s
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim(),
  )
  .filter((s) => s.length > 0);
