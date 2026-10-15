// Canonical game values shared by routes and the scan catalogue.
const GAMES = Object.freeze(['pokemon', 'mtg', 'lorcana', 'riftbound']);
const isGame = (game) => GAMES.includes(game);
module.exports = { GAMES, isGame };
