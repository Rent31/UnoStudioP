import type { RoomState } from "./engine";
import {
  actAddBot,
  actBackToLobby,
  actChallenge,
  actChat,
  actChooseColor,
  actClearChat,
  actDraw,
  actEndDouble,
  actEndRound,
  actKick,
  actLeave,
  actNextRound,
  actPass,
  actPlay,
  actRemoveBot,
  actRouletteColor,
  actRouletteFinish,
  actRoulettePull,
  actRename,
  actReorder,
  actSetAdmin,
  actSetChat,
  actSetRule,
  actSetSpectate,
  actSetVariant,
  actShuffleSeats,
  actSkipTurn,
  actStart,
  actUno,
  findPlayer,
} from "./engine";
import type { Variant } from "./model";

export interface GameCommand {
  type: string;
  payload?: Record<string, unknown>;
  nonce?: string;
}

/** Apply one authenticated command to the authoritative room state. */
export function dispatchGameCommand(
  state: RoomState,
  playerId: string,
  command: GameCommand,
): string | null {
  const p = findPlayer(state, playerId);
  if (!p || p.left) return "Bad session. Rejoin the room.";

  p.lastSeen = Date.now();
  p.connected = true;
  const body = command.payload ?? {};

  switch (command.type) {
    case "ping": return null;
    case "setVariant": return actSetVariant(state, p.id, body.variant as Variant);
    case "setSpectate": return actSetSpectate(state, p.id, String(body.targetId ?? ""), !!body.value);
    case "setRule": return actSetRule(state, p.id, String(body.name), body.value as boolean | number);
    case "reorder": return actReorder(state, p.id, (body.order as string[]) ?? []);
    case "shuffleSeats": return actShuffleSeats(state, p.id);
    case "chat": return actChat(state, p.id, String(body.text ?? ""));
    case "setChat": return actSetChat(state, p.id, !!body.value);
    case "clearChat": return actClearChat(state, p.id);
    case "endDouble": return actEndDouble(state, p.id);
    case "addBot": {
      const result = actAddBot(state, p.id);
      return typeof result === "string" ? result : null;
    }
    case "removeBot": return actRemoveBot(state, p.id, String(body.targetId ?? ""));
    case "start": return actStart(state, p.id);
    case "kick": return actKick(state, p.id, String(body.targetId ?? ""));
    case "leave": return actLeave(state, p.id);
    case "rename": return actRename(state, p.id, String(body.targetId ?? ""), String(body.name ?? ""));
    case "setAdmin": return actSetAdmin(state, p.id, String(body.targetId ?? ""), !!body.value);
    case "skipTurn": return actSkipTurn(state, p.id);
    case "endRound": return actEndRound(state, p.id);
    case "nextRound": return actNextRound(state, p.id);
    case "backToLobby": return actBackToLobby(state, p.id);
    case "play": return actPlay(state, p.id, String(body.cardId ?? ""), {
      color: body.color as never,
      targetId: body.targetId as string | undefined,
      useFlex: body.useFlex as boolean | undefined,
    });
    case "draw": return actDraw(state, p.id);
    case "pass": return actPass(state, p.id);
    case "uno": return actUno(state, p.id);
    case "challenge": return actChallenge(state, p.id, !!body.value);
    case "chooseColor": return actChooseColor(state, p.id, body.color as never);
    case "rouletteColor": return actRouletteColor(state, p.id, body.color as never);
    case "roulettePull": return actRoulettePull(state, p.id);
    case "rouletteFinish": return actRouletteFinish(state, p.id);
    default: return "Unknown action";
  }
}
