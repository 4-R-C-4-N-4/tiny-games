export type Suit = 'major' | 'pentacles' | 'cups' | 'swords' | 'wands';
export interface TarotCard {
  id: string;
  name: string;
  suit: Suit;
  number: number;
  description: string;
  meaningUpright: string;
  meaningReversed: string;
}
export type SpreadType = 'three-card' | 'celtic-cross';
export interface SpreadResult {
  type: SpreadType;
  cards: Array<{
    card: TarotCard;
    position: string;
    isReversed: boolean;
  }>;
  seed: string;
  reversalsAllowed: boolean;
}