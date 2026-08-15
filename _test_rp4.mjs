import { readFileSync } from 'fs';
const cardsJs = readFileSync('./js/cards.js', 'utf8');
const decksJs = readFileSync('./js/mhr-decks.js', 'utf8');
const dataJs = readFileSync('./js/data.js', 'utf8');
const engineJs = readFileSync('./js/engine.js', 'utf8');

global.window = global;
eval(cardsJs); eval(decksJs); eval(dataJs); eval(engineJs);

const dc = global.MHR_DATA.DECKS.BLUE_Control;
console.log('First 5 cards:', dc.slice(0,5).map(c => `${c.id}:${c.set}`));
console.log('Last 5 cards:', dc.slice(-5).map(c => `${c.id}:${c.set}`));
console.log('SD03 count in BLUE_Control deck:', dc.filter(c => c.set === 'SD03').length);
console.log('BP01 count:', dc.filter(c => c.set === 'BP01').length);

// Now test buildRushDeck isolation
for (let i = 0; i < 10; i++) {
  const s = global.MHR_ENGINE.initGame('RED_Aggro', 'BLUE_Control');
  const aiDeck = s.players.A;
  console.log(`Run ${i}: A.deck[0].set = ${aiDeck.deck[0].set}, rushDeck has SD03: ${aiDeck.rushDeck.some(c => c.set === 'SD03')}`);
}