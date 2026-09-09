<script setup lang="ts">
import { useDashboardContext } from "../composables/dashboardContext.js";
const { token, isLoading, errorMessage, login } = useDashboardContext();
</script>

<template>
  <main class="login-shell">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="brand-mark" aria-hidden="true"></div>
      <p class="eyebrow">FullParty Bot</p>
      <h1 id="login-title">Admin Login</h1>
      <form class="token-form" @submit.prevent="login">
        <label for="token">Admin API token</label>
        <input
          id="token"
          v-model="token"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          type="password"
          placeholder="Paste token"
          :disabled="isLoading"
        />
        <button type="submit" :disabled="isLoading">
          {{ isLoading ? "Checking..." : "Log in" }}
        </button>
      </form>
      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </section>
  </main>
</template>
