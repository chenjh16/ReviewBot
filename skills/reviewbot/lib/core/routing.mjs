/**
 * Agent routing utilities — pure functions for parsing
 * agent-targeted messages and managing symbol assignments.
 */

const SYMBOL_POOL = [
  '📋', '🔍', '✨', '🎯', '📝', '💡', '🔖', '📌', '🧩', '🎲',
  '⚡', '🌟', '🔔', '📎', '🏷️', '🪄', '🎪', '🧪', '🔬', '🎨',
];

export { SYMBOL_POOL };

export function parseAgentRoute(content) {
  const match = content.match(/^#([\w:.@-]+)\s*([\s\S]*)$/);
  if (match) return { agentId: match[1], message: match[2].trim() };
  return { agentId: null, message: content.trim() };
}

export function createSymbolAssigner() {
  const agentSymbols = new Map();
  let nextIdx = 0;
  return {
    assign(agentId) {
      if (!agentSymbols.has(agentId)) {
        agentSymbols.set(agentId, SYMBOL_POOL[nextIdx++ % SYMBOL_POOL.length]);
      }
      return agentSymbols.get(agentId);
    },
    get(agentId) { return agentSymbols.get(agentId); },
    getMap() { return agentSymbols; },
    getNextIdx() { return nextIdx; },
    restore(map, idx) {
      for (const [k, v] of Object.entries(map)) agentSymbols.set(k, v);
      nextIdx = idx;
    },
  };
}
