/**
 * MetaFight is local-only. Preserve the interface during M0 but disable every
 * relay path, including localhost and ?relay= overrides. M0.5 removes the
 * online UI and imports from the production module graph.
 */
export const DEFAULT_RELAY = '';

export function relayFor() {
  return null;
}
