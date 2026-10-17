/* shared/protocol.js
 * Message contract for the FUTURE multiplayer server.
 * Single-player today ignores this file; it exists so the client input
 * pipeline is already shaped like network input:
 *   client → server:  { t:'input', seq, mx, my }  + { t:'action', kind }
 *   server → client:  { t:'snap', state }         (full or delta)
 *
 * When we add multiplayer, the server will import shared/sim.js,
 * run stepGame per room tick, and broadcast snaps. No sim changes needed.
 */
export const MSG = {
  JOIN: 'join',
  INPUT: 'input',
  ACTION: 'action',
  SNAP: 'snap',
  CHAT: 'chat',
};

// Local adapter: lets client code treat "the game" the same way
// whether sim runs in-page (today) or on a server (tomorrow).
export function makeLocalLink(game, sim) {
  return {
    // matches future server API: send input, receive state
    sendInput(input, dtMs, rng) {
      return sim.stepGame(game, input, dtMs, rng);
    },
    doAction() {
      return sim.doAction(game);
    },
    get state() {
      return game;
    },
  };
}
