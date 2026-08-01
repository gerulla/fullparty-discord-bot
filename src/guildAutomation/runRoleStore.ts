import { openSqliteDatabase } from "../database/sqlite.js";

export type GuildRunRoleMapping = {
  createdAt: string;
  deletedAt?: string;
  discordGuildId: string;
  roleId: string;
  roleName: string;
  runId: number;
  status: "active" | "deleted";
  templateRoleId: string;
  updatedAt: string;
};

export type GuildRunRoleStore = {
  close?(): void;
  get(discordGuildId: string, runId: number): Promise<GuildRunRoleMapping | undefined>;
  listByGuild?(discordGuildId: string): Promise<GuildRunRoleMapping[]>;
  markDeleted(discordGuildId: string, runId: number): Promise<void>;
  markDeletedByRole?(discordGuildId: string, roleId: string): Promise<void>;
  upsert(mapping: GuildRunRoleMapping): Promise<GuildRunRoleMapping>;
};

type GuildRunRoleRow = {
  created_at: string;
  deleted_at: string | null;
  discord_guild_id: string;
  role_id: string;
  role_name: string;
  run_id: number;
  status: "active" | "deleted";
  template_role_id: string;
  updated_at: string;
};

export class SqliteGuildRunRoleStore implements GuildRunRoleStore {
  private readonly database;

  public constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    this.initialize();
  }

  public get(
    discordGuildId: string,
    runId: number,
  ): Promise<GuildRunRoleMapping | undefined> {
    const row = this.database
      .prepare(
        `
          SELECT
            created_at,
            deleted_at,
            discord_guild_id,
            role_id,
            role_name,
            run_id,
            status,
            template_role_id,
            updated_at
          FROM guild_run_roles
          WHERE discord_guild_id = ?
            AND run_id = ?
        `,
      )
      .get(discordGuildId, runId) as GuildRunRoleRow | undefined;

    return Promise.resolve(row ? rowToGuildRunRoleMapping(row) : undefined);
  }

  public listByGuild(discordGuildId: string): Promise<GuildRunRoleMapping[]> {
    const rows = this.database
      .prepare(
        `
          SELECT
            created_at,
            deleted_at,
            discord_guild_id,
            role_id,
            role_name,
            run_id,
            status,
            template_role_id,
            updated_at
          FROM guild_run_roles
          WHERE discord_guild_id = ?
          ORDER BY run_id ASC
        `,
      )
      .all(discordGuildId) as GuildRunRoleRow[];

    return Promise.resolve(rows.map(rowToGuildRunRoleMapping));
  }

  public markDeleted(discordGuildId: string, runId: number): Promise<void> {
    const now = new Date().toISOString();

    this.database
      .prepare(
        `
          UPDATE guild_run_roles
          SET
            deleted_at = ?,
            status = 'deleted',
            updated_at = ?
          WHERE discord_guild_id = ?
            AND run_id = ?
        `,
      )
      .run(now, now, discordGuildId, runId);

    return Promise.resolve();
  }

  public markDeletedByRole(discordGuildId: string, roleId: string): Promise<void> {
    const now = new Date().toISOString();

    this.database
      .prepare(
        `
          UPDATE guild_run_roles
          SET
            deleted_at = ?,
            status = 'deleted',
            updated_at = ?
          WHERE discord_guild_id = ?
            AND role_id = ?
        `,
      )
      .run(now, now, discordGuildId, roleId);

    return Promise.resolve();
  }

  public upsert(mapping: GuildRunRoleMapping): Promise<GuildRunRoleMapping> {
    this.database
      .prepare(
        `
          INSERT INTO guild_run_roles (
            created_at,
            deleted_at,
            discord_guild_id,
            role_id,
            role_name,
            run_id,
            status,
            template_role_id,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(discord_guild_id, run_id) DO UPDATE SET
            deleted_at = excluded.deleted_at,
            role_id = excluded.role_id,
            role_name = excluded.role_name,
            status = excluded.status,
            template_role_id = excluded.template_role_id,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        mapping.createdAt,
        mapping.deletedAt ?? null,
        mapping.discordGuildId,
        mapping.roleId,
        mapping.roleName,
        mapping.runId,
        mapping.status,
        mapping.templateRoleId,
        mapping.updatedAt,
      );

    return Promise.resolve(mapping);
  }

  public close(): void {
    this.database.close();
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS guild_run_roles (
        discord_guild_id TEXT NOT NULL,
        run_id INTEGER NOT NULL,
        role_id TEXT NOT NULL,
        role_name TEXT NOT NULL,
        template_role_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'deleted')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (discord_guild_id, run_id)
      )
    `);
  }
}

function rowToGuildRunRoleMapping(row: GuildRunRoleRow): GuildRunRoleMapping {
  return {
    createdAt: row.created_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    discordGuildId: row.discord_guild_id,
    roleId: row.role_id,
    roleName: row.role_name,
    runId: row.run_id,
    status: row.status,
    templateRoleId: row.template_role_id,
    updatedAt: row.updated_at,
  };
}
