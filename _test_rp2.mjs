import { readFileSync } from 'fs';
const cardsJs = readFileSync('./js/cards.js', 'utf8');
const decksJs = readFileSync('./js/mhr-decks.js', 'utf8');
const dataJs = readFileSync('./js/data.js', 'utf8');
const engineJs = readFileSync('./js/engine.js', 'utf8');

global.window = global;
eval(cardsJs); eval(decksJs); eval(dataJs); eval(engineJs);

// Inspect BLUE_Control deck set detection
const dc = global.MHR_DATA.DECKS.BLUE_Control;
console.log('BLUE_Control first card set:', dc[0]?.set);
console.log('BLUE_Control deck[0,1,2]:', dc.slice(0,3).map(c => c.id + ':' + c.set));
console.log('Total:', dc.length, 'all sets:', [...new Set(dc.map(c => c.set))]);

// Run 20 times — count SD03 presence
let sd03Count = 0;
for (let run = 0; run < 20; run++) {
  const s = global.MHR_ENGINE.initGame('RED_Aggro', 'BLUE_Control');
  const aiRush = s.players.A.rushDeck.map(c => c.id);
  if (aiRush.includes('SD03-019')) sd03Count++;
  if (run < 3) console.log(`Run ${run}:`, aiRush);
}
console.log(`\nSD03-019 presence in AI rushDeck: ${sd03Count}/20`);