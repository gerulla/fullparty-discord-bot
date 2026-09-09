<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import {
  formatNumber,
  formatNullableNumber,
  formatDateTime,
  formatFailureTitle,
  formatGuildName,
  formatSettingValue,
  formatBoolean,
  formatCheckName,
  humanizeKey,
  capitalize,
} from "../lib/formatters.js";
import ApexChart from "vue3-apexcharts";
const {
  dashboard,
  selectedGuildId,
  isMemberCacheRefreshing,
  memberCacheRefreshMessage,
  guildDetails,
  selectedGuild,
  selectedGuildSeries,
  selectedGuildOptions,
  selectedGuildStatCards,
  refreshGuildMemberCache,
} = useDashboardContext();
</script>

<template>
  <section class="section-grid">
    <article class="panel wide guild-picker-panel">
      <div class="panel-heading">
        <div>
          <h2>Guild Inspector</h2>
          <p>
            Select a guild the bot is in and inspect its current setup, health, and recent
            activity.
          </p>
        </div>
        <span class="status-chip">
          {{ formatNumber(dashboard?.guilds.total ?? 0) }} guilds
        </span>
      </div>

      <label class="guild-selector" for="guild-selector">
        <span>Selected guild</span>
        <select
          id="guild-selector"
          v-model="selectedGuildId"
          :disabled="guildDetails.length === 0"
        >
          <option
            v-for="guildDashboard in guildDetails"
            :key="guildDashboard.guild.discordGuildId"
            :value="guildDashboard.guild.discordGuildId"
          >
            {{ formatGuildName(guildDashboard.guild) }}
          </option>
        </select>
      </label>
    </article>

    <div v-if="!selectedGuild" class="empty-state">
      No guild runtime records have been captured yet.
    </div>

    <template v-else>
      <article class="panel wide guild-hero-panel">
        <div>
          <p class="eyebrow">Selected Guild</p>
          <h2>{{ formatGuildName(selectedGuild.guild) }}</h2>
          <p>{{ selectedGuild.guild.discordGuildId }}</p>
        </div>
        <div class="guild-chip-row">
          <span class="status-chip" :class="selectedGuild.health.status">
            {{ capitalize(selectedGuild.health.status) }}
          </span>
          <span
            class="status-chip"
            :class="selectedGuild.guild.linked ? 'healthy' : 'degraded'"
          >
            {{ selectedGuild.guild.linked ? "Linked" : "Not linked" }}
          </span>
          <span
            class="status-chip"
            :class="selectedGuild.guild.unavailable ? 'unhealthy' : 'healthy'"
          >
            {{ selectedGuild.guild.unavailable ? "Unavailable" : "Available" }}
          </span>
        </div>
      </article>

      <div class="stat-grid">
        <article
          v-for="card in selectedGuildStatCards"
          :key="`guild-${card.label}`"
          class="stat-card"
        >
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.subvalue }}</small>
        </article>
      </div>

      <article class="panel wide">
        <ApexChart
          height="320"
          type="bar"
          :options="selectedGuildOptions"
          :series="selectedGuildSeries"
        />
      </article>

      <section class="section-grid two-column">
        <article class="panel info-panel">
          <h2>Runtime & Settings</h2>
          <dl>
            <div>
              <dt>Last Seen</dt>
              <dd>{{ formatDateTime(selectedGuild.guild.lastSeenAt) }}</dd>
            </div>
            <div>
              <dt>Linked At</dt>
              <dd>{{ formatDateTime(selectedGuild.guild.linkedAt) }}</dd>
            </div>
            <div>
              <dt>Bot Log Channel</dt>
              <dd>{{ formatSettingValue(selectedGuild.guild.botLogChannelId) }}</dd>
            </div>
            <div>
              <dt>Member-Facing Channel</dt>
              <dd>
                {{ formatSettingValue(selectedGuild.guild.runAnnouncementChannelId) }}
              </dd>
            </div>
            <div>
              <dt>Template Role</dt>
              <dd>
                {{ formatSettingValue(selectedGuild.guild.upcomingRaiderRoleId) }}
              </dd>
            </div>
            <div>
              <dt>Moderator Role</dt>
              <dd>
                {{ formatSettingValue(selectedGuild.guild.botModeratorRoleId) }}
              </dd>
            </div>
            <div>
              <dt>Nickname Sync</dt>
              <dd>{{ formatBoolean(selectedGuild.guild.syncDiscordNamesToFf14) }}</dd>
            </div>
            <div>
              <dt>Bot Permissions</dt>
              <dd>{{ selectedGuild.guild.botPermissions ?? "Unknown" }}</dd>
            </div>
          </dl>
        </article>

        <article class="panel info-panel">
          <div class="panel-heading compact-heading">
            <div>
              <h2>Member Cache</h2>
              <p>
                Refresh linked visible guilds and mark unavailable cache rows obsolete.
              </p>
            </div>
            <button
              class="inline-button"
              type="button"
              :disabled="isMemberCacheRefreshing"
              @click="refreshGuildMemberCache"
            >
              {{ isMemberCacheRefreshing ? "Queueing..." : "Force refresh" }}
            </button>
          </div>
          <p v-if="memberCacheRefreshMessage" class="helper-message">
            {{ memberCacheRefreshMessage }}
          </p>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{{ selectedGuild.guild.refreshStatus ?? "Unknown" }}</dd>
            </div>
            <div>
              <dt>Cached Members</dt>
              <dd>
                {{ formatNullableNumber(selectedGuild.guild.cachedMemberCount) }}
              </dd>
            </div>
            <div>
              <dt>Discord Members</dt>
              <dd>{{ formatNullableNumber(selectedGuild.guild.memberCount) }}</dd>
            </div>
            <div>
              <dt>Last Refresh</dt>
              <dd>{{ formatDateTime(selectedGuild.guild.lastFullRefreshAt) }}</dd>
            </div>
            <div>
              <dt>Next Refresh</dt>
              <dd>{{ formatDateTime(selectedGuild.guild.nextRefreshAfter) }}</dd>
            </div>
            <div>
              <dt>Last Error</dt>
              <dd>{{ selectedGuild.guild.lastError ?? "None" }}</dd>
            </div>
          </dl>
        </article>
      </section>

      <article class="panel wide">
        <div class="panel-heading">
          <div>
            <h2>Guild Health</h2>
            <p>Setup and runtime issues for this guild only.</p>
          </div>
          <span class="status-chip" :class="selectedGuild.health.status">
            {{ capitalize(selectedGuild.health.status) }}
          </span>
        </div>
        <div v-if="selectedGuild.health.issues.length === 0" class="empty-state">
          No guild-specific issues found.
        </div>
        <div v-else class="issue-list">
          <article
            v-for="issue in selectedGuild.health.issues"
            :key="issue.key"
            class="issue-card"
            :class="issue.severity"
          >
            <div class="issue-header">
              <div>
                <strong>{{ formatCheckName(issue.key) }}</strong>
                <p>{{ issue.reason }}</p>
              </div>
              <span class="status-chip" :class="issue.status">
                {{ capitalize(issue.status) }}
              </span>
            </div>
            <dl class="compact-details">
              <div>
                <dt>When</dt>
                <dd>{{ formatDateTime(issue.occurredAt) }}</dd>
              </div>
              <div>
                <dt>Key</dt>
                <dd>{{ issue.key }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </article>

      <section class="section-grid two-column">
        <article class="panel recent-panel">
          <h2>Recent Failures</h2>
          <div v-if="selectedGuild.recent.failures.length === 0" class="empty-state">
            No guild-specific failures captured.
          </div>
          <div v-else class="recent-list">
            <article
              v-for="failure in selectedGuild.recent.failures"
              :key="failure.id"
              class="recent-row"
            >
              <strong>{{ formatFailureTitle(failure) }}</strong>
              <span>{{ failure.errorCode ?? failure.severity }}</span>
              <small>{{ formatDateTime(failure.occurredAt) }}</small>
            </article>
          </div>
        </article>

        <article class="panel recent-panel">
          <h2>Recent Automation</h2>
          <div
            v-if="selectedGuild.recent.automationRuns.length === 0"
            class="empty-state"
          >
            No guild automation records captured.
          </div>
          <div v-else class="recent-list">
            <article
              v-for="automation in selectedGuild.recent.automationRuns"
              :key="automation.id"
              class="recent-row"
            >
              <strong>{{ humanizeKey(automation.automationType) }}</strong>
              <span>
                {{ automation.status }} · {{ automation.successCount }} ok /
                {{ automation.failureCount }} failed
              </span>
              <small>{{ formatDateTime(automation.occurredAt) }}</small>
            </article>
          </div>
        </article>

        <article class="panel recent-panel">
          <h2>Recent Guild Messages</h2>
          <div v-if="selectedGuild.recent.guildMessages.length === 0" class="empty-state">
            No guild message records captured.
          </div>
          <div v-else class="recent-list">
            <article
              v-for="message in selectedGuild.recent.guildMessages"
              :key="message.id"
              class="recent-row"
            >
              <strong>{{ humanizeKey(message.messageType) }}</strong>
              <span
                >{{ message.status
                }}{{ message.errorCode ? ` · ${message.errorCode}` : "" }}</span
              >
              <small>{{ formatDateTime(message.occurredAt) }}</small>
            </article>
          </div>
        </article>

        <article class="panel recent-panel">
          <h2>Recent Commands & Events</h2>
          <div
            v-if="
              selectedGuild.recent.commandUsages.length === 0 &&
              selectedGuild.recent.events.length === 0
            "
            class="empty-state"
          >
            No guild command or event records captured.
          </div>
          <div v-else class="recent-list">
            <article
              v-for="command in selectedGuild.recent.commandUsages"
              :key="`command-${command.id}`"
              class="recent-row"
            >
              <strong>/{{ command.commandName }}</strong>
              <span
                >{{ command.status
                }}{{ command.errorCode ? ` · ${command.errorCode}` : "" }}</span
              >
              <small>{{ formatDateTime(command.occurredAt) }}</small>
            </article>
            <article
              v-for="event in selectedGuild.recent.events"
              :key="`event-${event.id}`"
              class="recent-row"
            >
              <strong>{{ event.eventType }}</strong>
              <span
                >{{ event.status
                }}{{ event.errorCode ? ` · ${event.errorCode}` : "" }}</span
              >
              <small>{{ formatDateTime(event.occurredAt) }}</small>
            </article>
          </div>
        </article>
      </section>
    </template>
  </section>
</template>
