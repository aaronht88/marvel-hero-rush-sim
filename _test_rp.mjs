import { readFileSync, existsSync } from 'fs';
const cardsJs = readFileSync('./js/cards.js', 'utf8');
const decksJs = readFileSync('./js/mhr-decks.js', 'utf8');
const dataJs = readFileSync('./js/data.js', 'utf8');
const engineJs = readFileSync('./js/engine.js', 'utf8');

global.window = global;
eval(cardsJs); eval(decksJs); eval(dataJs); eval(engineJs);

for (let run = 0; run < 5; run++) {
  const s = global.MHR_ENGINE.initGame('RED_Aggro', 'BLUE_Control');
  console.log(`\n--- Run ${run + 1} ---`);
  console.log('Player rushDeck (RED_Aggro → BP01):', s.players.P.rushDeck.map(c => c.id));
  console.log('AI rushDeck (BLUE_Control → SD03):', s.players.A.rushDeck.map(c => c.id));
}

console.log('\n=== GREEN_Tempo (SD04) ===');
const s2 = global.MHR_ENGINE.initGame('GREEN_Tempo', 'RED_Aggro');
console.log('P rushDeck:', s2.players.P.rushDeck.map(c => c.id));
console.log('A rushDeck:', s2.players.A.rushDeck.map(c => c.id));

console.log('\n=== Art existence ===');
const set1 = s2.players.P.rushDeck.slice(0, 3);
for (const c of set1) {
  console.log(c.id, existsSync('./' + c.art) ? 'OK' : 'MISSING');
}