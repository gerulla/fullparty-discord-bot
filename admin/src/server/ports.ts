import type {
  HealthSnapshot,
  MemberCacheRefreshResult,
  RuntimeLogEntry,
  UserDmQueueSnapshot,
} from "../shared/contracts.js";
import type { AdminStore } from "../shared/telemetry.js";

export type AdminApiOptions = {
  adminApiToken?: string | undefined;
  store?: AdminStore | undefined;
  createHealth(): Promise<HealthSnapshot>;
  refreshGuildRuntime(): Promise<void>;
  refreshMemberCache?: (() => Promise<MemberCacheRefreshResult>) | undefined;
  getUserDmQueues(): UserDmQueueSnapshot[];
  runtimeLogs?:
    | {
        getEntries(limit: number): RuntimeLogEntry[];
        getMaxLines(): number;
        getTotalBuffered(): number;
        getPersistenceInfo(): {
          directoryPath: string | null;
          enabled: boolean;
          retentionDays: number | null;
        };
      }
    | undefined;
};
