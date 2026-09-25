import type { WireServerMessage } from '../wire';

/**
 * Frame che il server reale potrebbe mandare e che il contratto non prevede. Il client deve sopravvivere
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
  '{"type":"game_start","payload":{"white":"x","black":"y"}}',
  '{"type":"chat_message","payload":{"text":"ciao"}}',
  '{"type":"draw_offer","payload":null}',
  '{"type":"game_state","payload":{"board":7}}',
  '{"type":"timer_update","payload":{"white_time":"presto","black_time":null}}',
  '{"type":"hand","payload":{"hand":"spark"}}',
  '{"type":"spell_cast","payload":{"player":"mario","spell_id":"x","targets":[]}}',
  '{"type":"effect_expired","payload":{"square":42}}',
  '{"type":"card_drawn","payload":{}}',
  '{"type":"phase_changed","payload":{"phase":"draw"}}',
  '{"type":"error","payload":"stringa nuda"}',
  '{"type":"error","payload":{"message":"Un errore mai visto prima"}}',
];

/** Aggiunge rumore ai messaggi validi senza cambiarne il significato. */
function decorate(message: WireServerMessage, count: number): string {
  const payload: Record<string, unknown> = { ...message.payload, __unexpected_field: { count }, _server_version: 'x.y' };
  if (message.type === 'game_state' && count % 2 === 0) {
    payload['active_effects'] = 'oops'; // deve degradare a nessun effetto, non rompersi
  }
  if (message.type === 'spell_cast' && Array.isArray(message.payload['effects_applied'])) {
    payload['effects_applied'] = [...message.payload['effects_applied'], { kind: 'summon_dragon' }, { kind: 'move_piece' }];
  }
  return JSON.stringify({ type: message.type, payload, __envelope_extra: true });
}

/** Avvolge l'invio verso un client: ogni tre messaggi inserisce un frame ostile. */
export function hostileSender(sendRaw: (text: string) => void): (message: WireServerMessage) => void {
  let count = 0;
  return (message) => {
    count += 1;
    if (count % 3 === 0) sendRaw(HOSTILE_FRAMES[(count / 3) % HOSTILE_FRAMES.length] ?? '');
    sendRaw(decorate(message, count));
  };
}
