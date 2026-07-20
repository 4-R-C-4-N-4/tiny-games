import type { StatName } from './stats.ts';

// Procedural pixel art: one hand-drawn grid per enemy CLASS, palette-swapped
// by floor theme — the classic 8/16-bit trick. The same theme hue that tints
// the stage background tints the sprite accents, so it's coherent for free.
//
// Grid chars → palette slots:
//   .  transparent      o  outline           p  primary (robe/body)
//   P  primary shade    b  bone / face       g  glow (theme-bright)
//   a  accent trim (theme)                   m  metal / dark detail
//   w  pale detail

export type SpriteGrid = readonly string[];
export type SpriteArt = 'necromancer' | 'hierophant' | 'stormcaller' | 'dragon' | 'mirror' | 'player';

export const GRIDS: Record<SpriteArt, SpriteGrid> = {
  necromancer: [
    '..........oo.....ggg..',
    '.........oppo....ggg..',
    '........oppppo....m...',
    '.......oppppppo...m...',
    '......opPppppPpo..m...',
    '......oPobbbboPo..m...',
    '.....opoobbbboopo.m...',
    '.....opobgbbgbopo.m...',
    '.....opoobbbboopo.m...',
    '......opobmmbopo..m...',
    '......oppooooppo..m...',
    '.....oppppppppppo.m...',
    '.....opappppppapppm...',
    '....oppapppppapo..m...',
    '....opppaapaapppo.m...',
    '...oppppppppppppo.m...',
    '...opPpppppppPpo..m...',
    '..opppppppppppppo.m...',
    '..opPppppppppPppo.m...',
    '..oppo.opppo.oppo.m...',
    '..oo...opppo...oo.m...',
    '........oo........m...',
  ],
  hierophant: [
    '.........oaao.........',
    '........oawwao........',
    '........oawwao........',
    '.......oawwwwao.......',
    '.......oaawwaao.......',
    '.......oPmmmmPo.......',
    '......opmbggbmpo......',
    '......opmbbbbmpo......',
    '.......opmbbmpo.......',
    '......oppooooppo......',
    '.....oppppaapppppo....',
    '....opppppaappppppo...',
    '....oPppppaapppppPo...',
    '...opppppaaaappppppo..',
    '...oppppaawwaapppppo..',
    '...oPpppppaappppppPo..',
    '..opppppppaapppppppo..',
    '..oPppppppaappppppPo..',
    '..opppppppaapppppppo..',
    '..opppppppaapppppppo..',
    '..oppppoooooooppppo...',
    '...oooo.......oooo....',
  ],
  stormcaller: [
    '......g...g...g.......',
    '....g.gg..g..gg.g.....',
    '.....ogggggggggo......',
    '....ogggggggggggo.....',
    '....ogobbbbbbbogo.....',
    '....ogobgbbbgbogo.....',
    '.....oobbbbbbboo......',
    '.....opobmmbbopo......',
    '..g..oppoooooppo......',
    '..m.opppppppppppo.....',
    '..m.oppapppppappo.....',
    '..m.opppagggapppo.....',
    '..mpppppaggappppo.....',
    '..m.oppppaappppppo....',
    '..m.opPppppppppPpo....',
    '..m..opppppppppppo....',
    '..m..opPpppppppPpo....',
    '..m..oppppppppppo.....',
    '..m..oppo.oo.oppo.....',
    '..m...oo..oo...oo.....',
    '..m...................',
    '..m...................',
  ],
  dragon: [
    '...oo.......................',
    '..oppo...............o......',
    '..opppo.............oa......',
    'gopgppo............oaa......',
    '.opppppo..........oaaa......',
    '.owwoppo.........oaaaa......',
    '..oo.oppo.......oaaaaa......',
    '.....oppo......oaaaaaa......',
    '.....owppo....oaaaaaaa......',
    '......owppo..oaaaaaaaa......',
    '......owpppooaaaaaaaaa......',
    '.......owppppoaaaaaaao......',
    '.......owppppppaaaaaapo.....',
    '......owwpppppppppppppo.....',
    '......owwppppppppppppppo....',
    '......owwpppppppppppppppo...',
    '.......owwpppppo.opppppppo..',
    '........opppo.oppo..oppppo..',
    '........oppo...oppo...oppo..',
    '........omo.....omo....oppo.',
    '........................oppo',
    '.......................oppo.',
    '......................oapo..',
    '.....................oaao...',
  ],
  // Not a looking-glass: your reflection stepped out of one. Hooded double,
  // shard-flanked; palette takes the PLAYER's dominant-stat hue at runtime.
  mirror: [
    '.....g......oo......g...',
    '....ga.....oppo.....ag..',
    '.....g....oppppo....g...',
    '.........opPPPPpo.......',
    '........opPooooPpo......',
    '........opogoogopo......',
    '........opoooooopo......',
    '..a......oppooppo......a',
    '.ag....oppppppppppo...ga',
    '..a...oppapppppppapo..a.',
    '.....opppaapppaapppo....',
    '.....oPpppppaappppPo....',
    '....oppppagggapppppo....',
    '....oPpppaggggppppPo....',
    '..g.opppppppppppppppo...',
    '..a.oPppppppppppppPo....',
    '....opppppppppppppo.....',
    '....oPpppppppppppPo.....',
    '.....opppppppppppo..a...',
    '.....ooooooooooooo.g....',
    '...................a....',
    '........................',
  ],
  // Seen from behind, lower foreground — your build on your back.
  player: [
    '.........oooo.........',
    '........opPPpo....g...',
    '........oPPPPo...ggg..',
    '.......opPPPPpo...g...',
    '.......oPPPPPPo...m...',
    '........oPPPPo....m...',
    '....opppppppppppo.m...',
    '...oppPpppppppPpo.m...',
    '...opppppppppppppom...',
    '...oppappppppappo.m...',
    '..opppaapppppaappo.m..',
    '..oPpppaapppaappPo.m..',
    '..opppppaagaappppo.m..',
    '..oPppppagggapppPo.m..',
    '..oppppppagapppppo.m..',
    '..oPppppppppppppPo.m..',
    '..opppppppppppppo..m..',
    '..oPpppppppppppPo..m..',
    '...oppppppppppppo..m..',
    '...oPpppppppppPo...m..',
    '....oooo.oo.oooo...m..',
    '...................m..',
  ],
};

export interface Palette {
  o: string;
  p: string;
  P: string;
  b: string;
  g: string;
  a: string;
  m: string;
  w: string;
}

const OUTLINE = '#0e0b16';
const METAL = '#4a4356';

/** Class base robes; accents come from the floor theme. */
const CLASS_BASE: Record<Exclude<SpriteArt, 'player'>, { p: string; P: string; b: string; w: string }> = {
  necromancer: { p: 'hsl(268 22% 34%)', P: 'hsl(268 26% 24%)', b: '#ddd4c2', w: '#e8e2f4' },
  hierophant: { p: 'hsl(44 26% 68%)', P: 'hsl(44 22% 52%)', b: '#2a2438', w: '#f4eede' },
  stormcaller: { p: 'hsl(215 32% 30%)', P: 'hsl(215 34% 21%)', b: '#d9cfc0', w: '#e8f0f4' },
  dragon: { p: 'hsl(140 30% 30%)', P: 'hsl(140 34% 20%)', b: '#ddd4c2', w: '#dcc27e' },
  mirror: { p: 'hsl(250 14% 30%)', P: 'hsl(250 18% 20%)', b: '#c8c2d4', w: '#e8e2f4' },
};

/** Enemy palette: class base + theme-hue accent/glow. */
export function enemyPalette(art: Exclude<SpriteArt, 'player'>, themeHue: number): Palette {
  const base = CLASS_BASE[art];
  return {
    o: OUTLINE,
    m: METAL,
    ...base,
    a: `hsl(${themeHue} 55% 48%)`,
    g: `hsl(${themeHue} 85% 68%)`,
  };
}

/** Your dominant stat colors your cloak — the build is visible on your back. */
export const STAT_HUES: Record<StatName, number> = {
  ferocity: 355,
  guile: 285,
  stone: 35,
  grace: 130,
  resonance: 245,
};

export function playerPalette(dominant: StatName): Palette {
  const h = STAT_HUES[dominant];
  return {
    o: OUTLINE,
    m: METAL,
    p: `hsl(${h} 32% 36%)`,
    P: `hsl(${h} 36% 26%)`,
    b: '#ddd4c2',
    w: '#e8e2f4',
    a: `hsl(${h} 58% 54%)`,
    g: `hsl(${h} 85% 70%)`,
  };
}
