import type { PlayerConnection } from '../game/room';
import type { WireServerMessage } from '../wire';

/**
 * Frame che il server reale potrebbe mandare e che il briefing non prevede. Il client deve sopravvivere
 * a ciascuno senza crash e senza perdere la partita in corso.
 */
export const HOSTILE_FRAMES: readonly string[] = [
  '{not json',
  '',
  '42',
  'null',
  '[]',
  '{"type":123,"payload":{}}',
  '{"payload":{"type":"game_state"}}',
  '{"type":"future_feature","payload":{"x":1}}',
  '{"type":"chat_message","payload":{"text":"ciao"}}',
  '{"type":"draw_offer","payload":null}',
  '{"type":"game_state","payload":{"board":7}}',
  '{"type":"timer_update","payload":{"white_time":"presto","black_time":null}}',
  '{"type":"spell_cast","payload":{"player":"?","spell_id":"x","targets":"e4","effects_applied":{}}}',
  '{"type":"effect_expired","payload":{"piece_id":42}}',
  '{"type":"card_drawn","payload":{}}',
  '{"type":"phase_changed","payload":{"phase":"draw"}}',
  '{"type":"error","payload":"stringa nuda"}',
  '{"type":"error","payload":{"nested":{"deep":[1,2,3]}}}',
];

/** Aggiunge rumore ai messaggi validi senza cambiarne il significato. */
function decorate(message: WireServerMessage, count: number): string {
  const payload: Record<string, unknown> = { ...message.payload, __unexpected_field: { count }, _server_version: 'x.y' };
  if (message.type === 'game_state' && count % 2 === 0) {
    // Estensione assunta malformata (G1): il client deve degradare a `pieces: null`, non rompersi.
    payload['pieces'] = 'oops';
  }
  if (message.type === 'spell_cast') {
    payload['effects_applied'] = [...message.payload.effects_applied, { piece_id: 'no-kind' }, { kind: 'summon_dragon' }];
  }
  return JSON.stringify({ type: message.type, payload, __envelope_extra: true });
}

export function wrapHostile(inner: PlayerConnection): PlayerConnection {
  let count = 0;
  return {
    send(message) {
      count += 1;
      if (count % 3 === 0) inner.sendRaw(HOSTILE_FRAMES[(count / 3) % HOSTILE_FRAMES.length] ?? '');
      inner.sendRaw(decorate(message, count));
    },
    sendRaw: (text) => inner.sendRaw(text),
    close: () => inner.close(),
  };
}
