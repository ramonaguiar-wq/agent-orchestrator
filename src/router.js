'use strict';
// Picks a model for a task type from a JSON table.
// If the primary model has used up its token budget, the route's fallback is used instead.

class Router {
  constructor(config) {
    this.config = config;
  }

  select(taskType, usage = {}) {
    const route = this.config.routes[taskType];
    const base = route || this.config.default;
    const primary = base.model;
    const fallback = base.fallback || this.config.default.fallback || null;
    const budget = (this.config.budgets || {})[primary];
    const used = usage[primary] || 0;

    if (budget !== undefined && used >= budget && fallback) {
      return { model: fallback, fallback: null, reason: `${primary} budget used (${used}/${budget})`, rerouted: true };
    }
    return {
      model: primary,
      fallback,
      reason: route ? route.reason : 'unknown task type, default route',
      rerouted: false,
    };
  }
}

module.exports = Router;
