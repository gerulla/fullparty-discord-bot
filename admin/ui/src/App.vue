<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useDashboard } from "./composables/useDashboard.js";
import { provideDashboard } from "./composables/dashboardContext.js";
import { capitalize } from "./lib/formatters.js";
import LoginPage from "./pages/LoginPage.vue";
const OverviewPage = defineAsyncComponent(() => import("./pages/OverviewPage.vue"));
const EventsPage = defineAsyncComponent(() => import("./pages/EventsPage.vue"));
const MessagingPage = defineAsyncComponent(() => import("./pages/MessagingPage.vue"));
const GuildsPage = defineAsyncComponent(() => import("./pages/GuildsPage.vue"));
const AutomationPage = defineAsyncComponent(() => import("./pages/AutomationPage.vue"));
const LogPage = defineAsyncComponent(() => import("./pages/LogPage.vue"));
const FailuresPage = defineAsyncComponent(() => import("./pages/FailuresPage.vue"));
const state = useDashboard();
provideDashboard(state);
const {
  sections,
  activeSection,
  isLoading,
  errorMessage,
  isLoggedIn,
  healthTone,
  refreshDashboard,
  logout,
} = state;
</script>

<template>
  <LoginPage v-if="!isLoggedIn" />

  <main v-else class="dashboard-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark compact" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">FullParty</p>
          <strong>Bot Admin</strong>
        </div>
      </div>
      <nav aria-label="Dashboard sections">
        <button
          v-for="section in sections"
          :key="section"
          class="nav-button"
          :class="{ active: activeSection === section }"
          type="button"
          @click="activeSection = section"
        >
          {{ section }}
        </button>
      </nav>
      <div class="sidebar-footer">
        <button
          class="ghost-button"
          type="button"
          :disabled="isLoading"
          @click="refreshDashboard"
        >
          Refresh
        </button>
        <button class="ghost-button danger" type="button" @click="logout">Log out</button>
      </div>
    </aside>

    <section class="dashboard-main" aria-labelledby="dashboard-title">
      <header class="dashboard-header">
        <div>
          <p class="eyebrow">Live Operations</p>
          <h1 id="dashboard-title">{{ activeSection }}</h1>
        </div>
        <div class="health-pill" :class="healthTone">{{ capitalize(healthTone) }}</div>
      </header>

      <p v-if="errorMessage" class="error-message dashboard-error" role="alert">
        {{ errorMessage }}
      </p>

      <OverviewPage v-if="activeSection === 'Overview'" />

      <EventsPage v-else-if="activeSection === 'Events'" />

      <MessagingPage v-else-if="activeSection === 'Messaging'" />

      <GuildsPage v-else-if="activeSection === 'Guilds'" />

      <AutomationPage v-else-if="activeSection === 'Automation'" />

      <LogPage v-else-if="activeSection === 'Log'" />

      <FailuresPage v-else />
    </section>
  </main>
</template>
