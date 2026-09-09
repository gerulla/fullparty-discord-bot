<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
import {
  formatNumber,
  formatDateTime,
  formatDetails,
  formatFailureTitle,
  formatCheckName,
  capitalize,
} from "../lib/formatters.js";
const { totals, healthIssues, recentFailures } = useDashboardContext();
</script>

<template>
  <section class="section-grid two-column">
    <article class="panel info-panel">
      <h2>Failure Snapshot</h2>
      <dl>
        <div>
          <dt>Failures 24h</dt>
          <dd>{{ formatNumber(totals?.failures24h ?? 0) }}</dd>
        </div>
        <div>
          <dt>Event Failures</dt>
          <dd>{{ formatNumber(totals?.eventsFailed24h ?? 0) }}</dd>
        </div>
        <div>
          <dt>Command Failures</dt>
          <dd>{{ formatNumber(totals?.commandsFailed24h ?? 0) }}</dd>
        </div>
        <div>
          <dt>DM Failures</dt>
          <dd>{{ formatNumber(totals?.dmsFailed24h ?? 0) }}</dd>
        </div>
      </dl>
    </article>
    <article class="panel info-panel">
      <h2>Current Health Impact</h2>
      <div v-if="healthIssues.length === 0" class="empty-state">
        No active degraded or unhealthy checks.
      </div>
      <div v-else class="health-impact-list">
        <article
          v-for="issue in healthIssues"
          :key="`failure-health-${issue.check}`"
          class="mini-issue"
        >
          <span class="status-chip" :class="issue.status">
            {{ capitalize(issue.status) }}
          </span>
          <strong>{{ formatCheckName(issue.check) }}</strong>
          <p>{{ issue.reason }}</p>
        </article>
      </div>
    </article>

    <article class="panel wide">
      <div class="panel-heading">
        <div>
          <h2>Recent Failure Records</h2>
          <p>Exact stored failures from the bot failure log.</p>
        </div>
        <span class="status-chip">{{ formatNumber(recentFailures.length) }}</span>
      </div>

      <div v-if="recentFailures.length === 0" class="empty-state">
        No failure records captured yet.
      </div>
      <div v-else class="failure-list">
        <article
          v-for="failure in recentFailures"
          :key="failure.id"
          class="failure-card"
          :class="[failure.severity, { ignored: !failure.affectsHealth }]"
        >
          <div class="failure-header">
            <div>
              <strong>{{ formatFailureTitle(failure) }}</strong>
              <p>{{ failure.message }}</p>
            </div>
            <span
              class="status-chip"
              :class="failure.affectsHealth ? failure.severity : 'ignored'"
            >
              {{ failure.affectsHealth ? capitalize(failure.severity) : "Ignored" }}
            </span>
          </div>
          <dl class="compact-details">
            <div>
              <dt>When</dt>
              <dd>{{ formatDateTime(failure.occurredAt) }}</dd>
            </div>
            <div>
              <dt>Error Code</dt>
              <dd>{{ failure.errorCode ?? "none" }}</dd>
            </div>
            <div>
              <dt>Event</dt>
              <dd>{{ failure.eventType ?? "none" }}</dd>
            </div>
            <div>
              <dt>Guild</dt>
              <dd>{{ failure.discordGuildId ?? "none" }}</dd>
            </div>
            <div>
              <dt>User</dt>
              <dd>{{ failure.discordUserId ?? "none" }}</dd>
            </div>
            <div>
              <dt>Run</dt>
              <dd>{{ failure.runId ?? "none" }}</dd>
            </div>
          </dl>
          <details class="json-details">
            <summary>Failure details</summary>
            <pre>{{ formatDetails(failure.details) }}</pre>
          </details>
        </article>
      </div>
    </article>
  </section>
</template>
