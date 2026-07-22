import type { TarotCard } from './types';

// The 1909 Waite–Smith deck, art by Pamela Colman Smith (public domain).
// Scans sourced from Wikimedia Commons, resized to 300px WebP, keyed by
// card id. Bundled at build time — the single-file build inlines them all.
const SCANS = import.meta.glob('./cards/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export function cardScan(card: TarotCard): string | null {
  return SCANS[`./cards/${card.id}.webp`] ?? null;
}
