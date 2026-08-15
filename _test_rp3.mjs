import { readFileSync } from 'fs';
const cardsJs = readFileSync('./js/cards.js', 'utf8');
const decksJs = readFileSync('./js/mhr-decks.js', 'utf8');
const dataJs = readFileSync('./js/data.js', 'utf8');
const engineJs = readFileSync('./js/engine.js', 'utf8');

global.window = global;
eval(cardsJs); eval(decksJs); eval(dataJs); eval(engineJs);

// 50 runs with strict set inspection
const counts = { sd03: 0, totalSd03InRush: 0 };
for (let run = 0; run < 50; run++) {
  const s = global.MHR_ENGINE.initGame('RED_Aggro', 'BLUE_Control');
  const aiRush = s.players.A.rushDeck;
  const hasSd03 = aiRush.some(c => c.set === 'SD03');
  if (hasSd03) counts.sd03++;
  counts.totalSd03InRush += aiRush.filter(c => c.set === 'SD03').length;
}
console.log('SD03-set card present:', counts.sd03, '/', 50);
console.log('Total SD03 tokens across all 50 AI rushDecks:', counts.totalSd03InRush);
console.log('Expected if always 1: 50');