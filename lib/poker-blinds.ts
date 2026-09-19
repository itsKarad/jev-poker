export type Blinds = { small: number; big: number };

export const HANDS_PER_BLIND_LEVEL = 6;
const SMALL_BLINDS = [2, 3, 5, 8, 12, 18, 27, 40, 60];

export function blindsForHand(handNumber: number): Blinds {
  const level = Math.floor((Math.max(1, handNumber) - 1) / HANDS_PER_BLIND_LEVEL);
  let small = SMALL_BLINDS[Math.min(level, SMALL_BLINDS.length - 1)];
  for (let index = SMALL_BLINDS.length; index <= level; index += 1) {
    small = Math.round(small * 1.5);
  }
  return { small, big: small * 2 };
}
