/**
 * Room lifecycle.
 *
 * Business rules enforced here, all server-side:
 *
 *  - Only the room creator is ever charged. There is no code path that
 *    creates a transaction for a joining player.
 *  - A paid room is created in `pending_payment` and becomes `active` only
 *    when a verified transaction exists.
 *  - Joining is free, always, for everyone except the creator.
 *  - Rejoining a room you created does not create a second charge.
 *  - A request for a paid room while the gate is shut is REFUSED, not
 *    silently downgraded to free — the host must not end up in something
 *    different from what they confirmed.
 */

import type {
  BotDifficulty,
  RoomFunding,
  RoomPlayerView,
  RoomView,
} from '@ludolite/shared';
import { BOT_PROFILES } from '@ludolite/engine';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SeatIndex } from '@ludolite/engine';

import { audit } from '../audit.js';
import { config, type AppConfig } from '../config.js';
import { ApiError } from '../errors.js';
import { ensureHostingFeeOrder, requireOpenGate } from '../payments/service.js';
import type { PaymentProvider } from '../payments/provider.js';
import { allocateCode, normaliseCode } from './codes.js';

type RoomWithMembers = Prisma.RoomGetPayload<{
  include: { memberships: { include: { player: true } }; transactions: true; match: true };
}>;

const ROOM_INCLUDE = {
  memberships: { include: { player: true } },
  transactions: true,
  match: true,
} satisfies Prisma.RoomInclude;

/** Seat order mirrors the engine: 2-player sits opposite, 4-player goes round. */
function seatOrder(seatCount: number): SeatIndex[] {
  return seatCount === 2 ? [0, 2] : [0, 1, 2, 3];
}

export function toRoomView(room: RoomWithMembers): RoomView {
  const active = room.memberships.filter((m) => m.leftAt === null);

  // `paidHost` reads from the transaction record, never from a client claim.
  const verified = room.transactions.some((t) => t.status === 'verified');

  const players: RoomPlayerView[] = active
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((m) => ({
      playerId: m.playerId,
      displayName: m.player.displayName,
      seat: m.seat as SeatIndex,
      isHost: m.isHost,
      // Bots are always "present" — there is no socket to drop.
      connected: m.isBot ? true : m.connected,
      // A bot is never a paying host, whatever else is true.
      paidHost: !m.isBot && m.isHost && room.funding === 'paid' && verified,
      isBot: m.isBot,
      ...(m.isBot && m.botLevel
        ? { botLevel: m.botLevel as BotDifficulty }
        : {}),
    }));

  return {
    roomId: room.id,
    code: room.code,
    status: room.status,
    funding: room.funding,
    seatCount: room.seatCount as 2 | 4,
    players,
    hostPlayerId: room.hostPlayerId,
    createdAt: room.createdAt.toISOString(),
    matchId: room.match?.id ?? null,
    canStart: room.status === 'active' && players.length === room.seatCount,
  };
}

export async function loadRoom(
  prisma: PrismaClient,
  roomId: string,
): Promise<RoomWithMembers> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: ROOM_INCLUDE });
  if (!room) throw new ApiError('ROOM_NOT_FOUND', 'That room no longer exists.');
  return room;
}

export interface CreateRoomInput {
  readonly prisma: PrismaClient;
  readonly provider: PaymentProvider;
  readonly playerId: string;
  readonly seatCount: 2 | 4;
  readonly funding: RoomFunding;
  readonly consent?: {
    readonly acceptedTerms: boolean;
    readonly acknowledgedNoPrize: boolean;
    readonly displayedAmountPaise: number;
  };
  /** Fill the remaining seats with computer opponents. */
  readonly bots?: { readonly count: number; readonly level: BotDifficulty };
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly c?: AppConfig;
}

export interface CreateRoomResult {
  readonly room: RoomWithMembers;
  readonly transaction?: { id: string; providerOrderId: string | null; providerPublicKey?: string };
}

export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
  const { prisma, provider, playerId, seatCount, funding } = input;
  const c = input.c ?? config;

  const botRequest = input.bots;

  if (botRequest) {
    // A solo game against the computer has nobody to invite, so there is
    // nothing to host and nothing to charge for. Refuse the combination
    // outright rather than quietly charging for a single-player game.
    if (funding === 'paid') {
      throw new ApiError(
        'INVALID_REQUEST',
        'Games against the computer are always free. There is no hosting fee for a solo match.',
      );
    }
    if (botRequest.count < 1 || botRequest.count > seatCount - 1) {
      throw new ApiError(
        'INVALID_REQUEST',
        `A ${seatCount}-player room can hold 1 to ${seatCount - 1} computer opponents.`,
      );
    }
  }

  if (funding === 'paid') {
    // 1. The gate, before anything else. Throws 402 with the room never
    //    created, so a shut gate leaves no debris behind.
    await requireOpenGate({ prisma, playerId, c });

    // 2. Consent must be explicit and must match what was displayed. A
    //    mismatch means the host agreed to a different number than the one
    //    we would charge, so refuse rather than reconcile.
    const consent = input.consent;
    if (!consent?.acceptedTerms || !consent.acknowledgedNoPrize) {
      throw new ApiError(
        'CONSENT_REQUIRED',
        'Please confirm the hosting fee and the terms before creating a paid room.',
      );
    }
    if (consent.displayedAmountPaise !== c.hostingFeePaise) {
      throw new ApiError(
        'INVALID_REQUEST',
        'The fee shown to you does not match the current hosting fee. Please reload and try again.',
      );
    }
  }

  const code = await allocateCode(prisma);
  const seats = seatOrder(seatCount);
  const hostSeat = seats[0] ?? 0;

  const room = await prisma.room.create({
    data: {
      code,
      // A paid room is NOT joinable until payment is verified.
      status: funding === 'paid' ? 'pending_payment' : 'active',
      funding,
      seatCount,
      hostPlayerId: playerId,
      quotedFeePaise: funding === 'paid' ? c.hostingFeePaise : 0,
      currency: c.currency,
      activatedAt: funding === 'paid' ? null : new Date(),
      consentAcceptedTerms: input.consent?.acceptedTerms ?? null,
      consentAcknowledgedNoPrize: input.consent?.acknowledgedNoPrize ?? null,
      consentDisplayedPaise: input.consent?.displayedAmountPaise ?? null,
      consentAt: funding === 'paid' ? new Date() : null,
      memberships: {
        create: { playerId, seat: hostSeat, isHost: true, connected: false },
      },
    },
    include: ROOM_INCLUDE,
  });

  await audit(prisma, {
    action: 'room.created',
    actorType: 'player',
    actorId: playerId,
    subjectType: 'room',
    subjectId: room.id,
    detail: {
      funding,
      seatCount,
      quotedFeePaise: room.quotedFeePaise,
      bots: botRequest?.count ?? 0,
      botLevel: botRequest?.level ?? null,
    },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  if (botRequest) {
    // Bots take the seats immediately after the host, so a 2-player bot game
    // puts the computer opposite and a 4-player game fills the rest.
    await seatBots(prisma, room.id, seats.slice(1, 1 + botRequest.count), botRequest.level);
    return { room: await loadRoom(prisma, room.id) };
  }

  if (funding === 'free') {
    return { room };
  }

  // Only now, for a paid room, does an order get created — and only for the
  // creator. No other player in this room will ever get one.
  const order = await ensureHostingFeeOrder({
    prisma,
    provider,
    roomId: room.id,
    playerId,
    c,
  });

  return {
    room,
    transaction: {
      id: order.transaction.id,
      providerOrderId: order.transaction.providerOrderId,
      providerPublicKey: order.providerPublicKey,
    },
  };
}

/**
 * Create the Player rows for computer opponents and seat them.
 *
 * Each bot gets its own Player row so every foreign key and every join in the
 * schema behaves exactly as it does for a human. The device key is namespaced
 * and room-scoped, so a bot can never be mistaken for a returning human
 * device and can never inherit a payment.
 */
async function seatBots(
  prisma: PrismaClient,
  roomId: string,
  seats: readonly SeatIndex[],
  level: BotDifficulty,
): Promise<void> {
  const label = BOT_PROFILES[level].name;

  for (const [index, seat] of seats.entries()) {
    const name = seats.length > 1 ? `${label} ${index + 1}` : label;

    const bot = await prisma.player.create({
      data: {
        displayName: name,
        deviceKey: `bot:${roomId}:${seat}`,
      },
    });

    await prisma.roomMembership.create({
      data: {
        roomId,
        playerId: bot.id,
        seat,
        isHost: false,
        connected: true,
        isBot: true,
        botLevel: level,
      },
    });
  }

  await audit(prisma, {
    action: 'room.joined',
    actorType: 'system',
    subjectType: 'room',
    subjectId: roomId,
    // Recorded explicitly: a bot is never charged for anything.
    detail: { bots: seats.length, level, charged: false, feePaise: 0 },
  });
}

export interface JoinRoomInput {
  readonly prisma: PrismaClient;
  readonly playerId: string;
  readonly code: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/**
 * Join by code. Free for everyone — there is deliberately no payment
 * parameter, no fee lookup, and no transaction creation in this function.
 */
export async function joinRoom(input: JoinRoomInput): Promise<RoomWithMembers> {
  const { prisma, playerId } = input;
  const code = normaliseCode(input.code);

  if (code.length < 4) {
    throw new ApiError('INVALID_CODE', 'That room code does not look right.');
  }

  const room = await prisma.room.findFirst({
    where: { code, status: { in: ['pending_payment', 'active', 'in_play'] } },
    include: ROOM_INCLUDE,
  });

  if (!room) {
    throw new ApiError('ROOM_NOT_FOUND', 'No open room has that code.');
  }

  // Returning member: restore the seat, never charge, never duplicate.
  const existing = room.memberships.find((m) => m.playerId === playerId);
  if (existing) {
    if (existing.leftAt !== null) {
      await prisma.roomMembership.update({
        where: { id: existing.id },
        data: { leftAt: null },
      });
    }
    await audit(prisma, {
      action: 'room.reconnected',
      actorType: 'player',
      actorId: playerId,
      subjectType: 'room',
      subjectId: room.id,
      detail: { isHost: existing.isHost, charged: false },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return loadRoom(prisma, room.id);
  }

  // A paid room that has not been paid for is not joinable yet. Invitees must
  // not be able to enter a room the host has not funded.
  if (room.status === 'pending_payment') {
    throw new ApiError(
      'ROOM_NOT_ACTIVE',
      'This room is not ready yet. The host is still setting it up.',
    );
  }

  if (room.status === 'in_play') {
    throw new ApiError('ROOM_ALREADY_STARTED', 'That match has already started.');
  }

  const taken = new Set(room.memberships.filter((m) => m.leftAt === null).map((m) => m.seat));
  const seat = seatOrder(room.seatCount).find((s) => !taken.has(s));

  if (seat === undefined) {
    throw new ApiError('ROOM_FULL', 'That room is already full.');
  }

  await prisma.roomMembership.create({
    data: { roomId: room.id, playerId, seat, isHost: false, connected: false },
  });

  await audit(prisma, {
    action: 'room.joined',
    actorType: 'player',
    actorId: playerId,
    subjectType: 'room',
    subjectId: room.id,
    // Recorded explicitly: joining never costs anything.
    detail: { seat, charged: false, feePaise: 0 },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return loadRoom(prisma, room.id);
}

/**
 * Verify a room may start, and that a paid room was actually paid for.
 *
 * The payment check is repeated here rather than trusting `room.status`
 * alone: a room is only in `active` because activation ran, but asserting the
 * invariant at the point of use is what makes "never trust a client-side
 * payment-success screen" true even if some other path set the status.
 */
export async function assertRoomPlayable(
  prisma: PrismaClient,
  roomId: string,
): Promise<RoomWithMembers> {
  const room = await loadRoom(prisma, roomId);

  if (room.status === 'pending_payment') {
    throw new ApiError('PAYMENT_REQUIRED', 'This room has not been activated yet.');
  }
  if (room.status === 'cancelled') {
    throw new ApiError('ROOM_NOT_ACTIVE', 'This room was cancelled.');
  }
  if (room.status === 'complete') {
    throw new ApiError('ROOM_NOT_ACTIVE', 'This match has already finished.');
  }

  if (room.funding === 'paid') {
    const verified = room.transactions.some((t) => t.status === 'verified');
    if (!verified) {
      throw new ApiError(
        'PAYMENT_REQUIRED',
        'This paid room has no verified payment, so it cannot be played.',
      );
    }
  }

  return room;
}

export async function markConnected(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
  connected: boolean,
): Promise<void> {
  await prisma.roomMembership.updateMany({
    where: { roomId, playerId },
    data: { connected },
  });
}

export async function leaveRoom(
  prisma: PrismaClient,
  roomId: string,
  playerId: string,
): Promise<void> {
  await prisma.roomMembership.updateMany({
    where: { roomId, playerId },
    data: { leftAt: new Date(), connected: false },
  });
}
