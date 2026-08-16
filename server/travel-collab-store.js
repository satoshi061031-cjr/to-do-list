const crypto = require("node:crypto");
const { getDb } = require("./db");

function collabError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return normalizeUserId(value);
}

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function cleanData(value) {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw collabError("data must be an object.", 400);
  }
  return value;
}

function ensureTravelCollabTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS travel_trips (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      data_json TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS travel_trip_members (
      trip_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
      label TEXT,
      joined_at TEXT NOT NULL,
      PRIMARY KEY (trip_id, user_id),
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS travel_stops (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS travel_reservations (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      source_id TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE,
      UNIQUE (trip_id, source_id)
    );
    CREATE TABLE IF NOT EXISTS travel_invites (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invite_type TEXT NOT NULL CHECK (invite_type IN ('one_time', 'reusable')),
      email TEXT,
      created_by TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      accepted_at TEXT,
      FOREIGN KEY (trip_id) REFERENCES travel_trips(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_travel_members_user ON travel_trip_members(user_id, trip_id);
    CREATE INDEX IF NOT EXISTS idx_travel_stops_trip ON travel_stops(trip_id, position);
    CREATE INDEX IF NOT EXISTS idx_travel_reservations_trip ON travel_reservations(trip_id);
    CREATE INDEX IF NOT EXISTS idx_travel_invites_trip ON travel_invites(trip_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_travel_invites_token ON travel_invites(token_hash);
  `);
}

function createTravelCollabStore(options = {}) {
  const database = options.database || getDb();
  const clock = options.clock || (() => new Date());
  ensureTravelCollabTables(database);

  function currentIso() {
    return clock().toISOString();
  }

  function transaction(action) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  function membership(tripId, userId) {
    return database
      .prepare("SELECT * FROM travel_trip_members WHERE trip_id = ? AND user_id = ?")
      .get(String(tripId || ""), normalizeUserId(userId));
  }

  function assertMember(tripId, userId, ownerOnly = false) {
    const member = membership(tripId, userId);
    if (!member) throw collabError("Trip not found or access denied.", 404);
    if (ownerOnly && member.role !== "owner") {
      throw collabError("Only the trip owner can perform this action.", 403);
    }
    return member;
  }

  function tripRow(tripId) {
    return database.prepare("SELECT * FROM travel_trips WHERE id = ?").get(String(tripId || ""));
  }

  function assertRevision(row, baseRevision) {
    if (baseRevision == null || baseRevision === "") return;
    const base = Number(baseRevision);
    if (!Number.isInteger(base) || base < 1) {
      throw collabError("baseRevision must be a positive integer.", 400);
    }
    if (base !== row.revision) {
      const error = collabError("Trip has changed since it was loaded.", 409, "STALE_REVISION");
      error.currentRevision = row.revision;
      throw error;
    }
  }

  function bumpRevision(tripId) {
    const timestamp = currentIso();
    database
      .prepare("UPDATE travel_trips SET revision = revision + 1, updated_at = ? WHERE id = ?")
      .run(timestamp, tripId);
    return tripRow(tripId).revision;
  }

  function mapTrip(row, role) {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      title: row.title,
      data: parseJson(row.data_json),
      revision: row.revision,
      role: role || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapStop(row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      position: row.position,
      data: parseJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function mapReservation(row) {
    return {
      id: row.id,
      tripId: row.trip_id,
      sourceId: row.source_id || null,
      data: parseJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function createTrip({ ownerUserId, ownerLabel, title, data }) {
    const ownerId = normalizeUserId(ownerUserId);
    const tripTitle = String(title || "").trim();
    if (!ownerId) throw collabError("Owner is required.", 400);
    if (!tripTitle) throw collabError("Trip title is required.", 400);
    const id = uid();
    const timestamp = currentIso();
    transaction(() => {
      database
        .prepare(
          `INSERT INTO travel_trips
            (id, owner_user_id, title, data_json, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        )
        .run(id, ownerId, tripTitle, JSON.stringify(cleanData(data)), timestamp, timestamp);
      database
        .prepare(
          `INSERT INTO travel_trip_members (trip_id, user_id, role, label, joined_at)
           VALUES (?, ?, 'owner', ?, ?)`
        )
        .run(id, ownerId, String(ownerLabel || ownerId).trim() || ownerId, timestamp);
    });
    return mapTrip(tripRow(id), "owner");
  }

  function listTrips(userId) {
    const id = normalizeUserId(userId);
    if (!id) return [];
    return database
      .prepare(
        `SELECT t.*, m.role
         FROM travel_trips t
         JOIN travel_trip_members m ON m.trip_id = t.id
         WHERE m.user_id = ?
         ORDER BY t.updated_at DESC`
      )
      .all(id)
      .map((row) => mapTrip(row, row.role));
  }

  function getTrip(tripId, userId, options = {}) {
    const member = assertMember(tripId, userId);
    const row = tripRow(tripId);
    const requestedRevision = options.revision == null ? null : Number(options.revision);
    if (Number.isInteger(requestedRevision) && requestedRevision === row.revision) {
      return { id: row.id, revision: row.revision, unchanged: true };
    }
    return {
      ...mapTrip(row, member.role),
      stops: listStops(tripId, userId),
      reservations: listReservations(tripId, userId),
    };
  }

  function updateTrip(tripId, userId, input = {}) {
    assertMember(tripId, userId);
    return transaction(() => {
      const row = tripRow(tripId);
      assertRevision(row, input.baseRevision);
      const title = input.title == null ? row.title : String(input.title).trim();
      if (!title) throw collabError("Trip title is required.", 400);
      const data = input.data == null ? parseJson(row.data_json) : cleanData(input.data);
      const timestamp = currentIso();
      database
        .prepare("UPDATE travel_trips SET title = ?, data_json = ?, updated_at = ? WHERE id = ?")
        .run(title, JSON.stringify(data), timestamp, tripId);
      bumpRevision(tripId);
      return mapTrip(tripRow(tripId), membership(tripId, userId).role);
    });
  }

  function deleteTrip(tripId, userId, baseRevision) {
    assertMember(tripId, userId, true);
    return transaction(() => {
      const row = tripRow(tripId);
      assertRevision(row, baseRevision);
      const revision = row.revision + 1;
      database.prepare("DELETE FROM travel_trips WHERE id = ?").run(tripId);
      return { removed: true, id: tripId, revision };
    });
  }

  function listStops(tripId, userId) {
    assertMember(tripId, userId);
    return database
      .prepare("SELECT * FROM travel_stops WHERE trip_id = ? ORDER BY position, created_at")
      .all(tripId)
      .map(mapStop);
  }

  function createStop(tripId, userId, input = {}) {
    assertMember(tripId, userId);
    return transaction(() => {
      const trip = tripRow(tripId);
      assertRevision(trip, input.baseRevision);
      const id = String(input.id || "").trim() || uid();
      const timestamp = currentIso();
      const position = Number.isInteger(Number(input.position)) ? Number(input.position) : 0;
      database
        .prepare(
          `INSERT INTO travel_stops (id, trip_id, position, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, tripId, position, JSON.stringify(cleanData(input.data)), timestamp, timestamp);
      const revision = bumpRevision(tripId);
      return { stop: mapStop(database.prepare("SELECT * FROM travel_stops WHERE id = ?").get(id)), revision };
    });
  }

  function updateStop(tripId, stopId, userId, input = {}) {
    assertMember(tripId, userId);
    return transaction(() => {
      const trip = tripRow(tripId);
      assertRevision(trip, input.baseRevision);
      const row = database
        .prepare("SELECT * FROM travel_stops WHERE id = ? AND trip_id = ?")
        .get(stopId, tripId);
      if (!row) throw collabError("Stop not found.", 404);
      const position = input.position == null ? row.position : Number(input.position);
      if (!Number.isInteger(position)) throw collabError("position must be an integer.", 400);
      const data = input.data == null ? parseJson(row.data_json) : cleanData(input.data);
      database
        .prepare("UPDATE travel_stops SET position = ?, data_json = ?, updated_at = ? WHERE id = ?")
        .run(position, JSON.stringify(data), currentIso(), stopId);
      const revision = bumpRevision(tripId);
      return {
        stop: mapStop(database.prepare("SELECT * FROM travel_stops WHERE id = ?").get(stopId)),
        revision,
      };
    });
  }

  function deleteStop(tripId, stopId, userId, baseRevision) {
    assertMember(tripId, userId);
    return transaction(() => {
      assertRevision(tripRow(tripId), baseRevision);
      const result = database
        .prepare("DELETE FROM travel_stops WHERE id = ? AND trip_id = ?")
        .run(stopId, tripId);
      if (!result.changes) throw collabError("Stop not found.", 404);
      return { removed: true, revision: bumpRevision(tripId) };
    });
  }

  function listReservations(tripId, userId) {
    assertMember(tripId, userId);
    return database
      .prepare("SELECT * FROM travel_reservations WHERE trip_id = ? ORDER BY created_at")
      .all(tripId)
      .map(mapReservation);
  }

  function normalizeSourceId(value) {
    const sourceId = String(value || "").trim();
    return sourceId || null;
  }

  function insertReservation(tripId, input, timestamp) {
    const id = String(input.id || "").trim() || uid();
    const sourceId = normalizeSourceId(input.sourceId);
    try {
      database
        .prepare(
          `INSERT INTO travel_reservations
            (id, trip_id, source_id, data_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, tripId, sourceId, JSON.stringify(cleanData(input.data)), timestamp, timestamp);
    } catch (error) {
      if (sourceId && /UNIQUE constraint failed/.test(error.message)) {
        throw collabError("A reservation with this sourceId already exists.", 409, "DUPLICATE_SOURCE_ID");
      }
      throw error;
    }
    return database.prepare("SELECT * FROM travel_reservations WHERE id = ?").get(id);
  }

  function createReservation(tripId, userId, input = {}) {
    assertMember(tripId, userId);
    return transaction(() => {
      assertRevision(tripRow(tripId), input.baseRevision);
      const row = insertReservation(tripId, input, currentIso());
      return { reservation: mapReservation(row), revision: bumpRevision(tripId) };
    });
  }

  function importReservations(tripId, userId, input = {}) {
    assertMember(tripId, userId);
    const reservations = Array.isArray(input.reservations) ? input.reservations : [];
    if (!reservations.length) throw collabError("reservations must be a non-empty array.", 400);
    return transaction(() => {
      assertRevision(tripRow(tripId), input.baseRevision);
      const imported = [];
      const duplicates = [];
      const timestamp = currentIso();
      for (const candidate of reservations) {
        const sourceId = normalizeSourceId(candidate && candidate.sourceId);
        if (sourceId) {
          const existing = database
            .prepare("SELECT id FROM travel_reservations WHERE trip_id = ? AND source_id = ?")
            .get(tripId, sourceId);
          if (existing) {
            duplicates.push({ sourceId, reservationId: existing.id });
            continue;
          }
        }
        imported.push(mapReservation(insertReservation(tripId, candidate || {}, timestamp)));
      }
      return { imported, duplicates, revision: bumpRevision(tripId) };
    });
  }

  function updateReservation(tripId, reservationId, userId, input = {}) {
    assertMember(tripId, userId);
    return transaction(() => {
      assertRevision(tripRow(tripId), input.baseRevision);
      const row = database
        .prepare("SELECT * FROM travel_reservations WHERE id = ? AND trip_id = ?")
        .get(reservationId, tripId);
      if (!row) throw collabError("Reservation not found.", 404);
      const sourceId = input.sourceId === undefined ? row.source_id : normalizeSourceId(input.sourceId);
      const data = input.data == null ? parseJson(row.data_json) : cleanData(input.data);
      try {
        database
          .prepare(
            "UPDATE travel_reservations SET source_id = ?, data_json = ?, updated_at = ? WHERE id = ?"
          )
          .run(sourceId, JSON.stringify(data), currentIso(), reservationId);
      } catch (error) {
        if (sourceId && /UNIQUE constraint failed/.test(error.message)) {
          throw collabError("A reservation with this sourceId already exists.", 409, "DUPLICATE_SOURCE_ID");
        }
        throw error;
      }
      const revision = bumpRevision(tripId);
      return {
        reservation: mapReservation(
          database.prepare("SELECT * FROM travel_reservations WHERE id = ?").get(reservationId)
        ),
        revision,
      };
    });
  }

  function deleteReservation(tripId, reservationId, userId, baseRevision) {
    assertMember(tripId, userId);
    return transaction(() => {
      assertRevision(tripRow(tripId), baseRevision);
      const result = database
        .prepare("DELETE FROM travel_reservations WHERE id = ? AND trip_id = ?")
        .run(reservationId, tripId);
      if (!result.changes) throw collabError("Reservation not found.", 404);
      return { removed: true, revision: bumpRevision(tripId) };
    });
  }

  function listMembers(tripId, userId) {
    assertMember(tripId, userId);
    return database
      .prepare(
        `SELECT trip_id AS tripId, user_id AS userId, role, label, joined_at AS joinedAt
         FROM travel_trip_members WHERE trip_id = ?
         ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, joined_at`
      )
      .all(tripId);
  }

  function removeMember(tripId, targetUserId, actorUserId, baseRevision) {
    assertMember(tripId, actorUserId, true);
    const targetId = normalizeUserId(targetUserId);
    return transaction(() => {
      assertRevision(tripRow(tripId), baseRevision);
      const target = membership(tripId, targetId);
      if (!target) throw collabError("Member not found.", 404);
      if (target.role === "owner") throw collabError("The trip owner cannot be removed.", 403);
      database
        .prepare("DELETE FROM travel_trip_members WHERE trip_id = ? AND user_id = ?")
        .run(tripId, targetId);
      return { removed: true, revision: bumpRevision(tripId) };
    });
  }

  function tokenHash(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
  }

  function inviteByToken(token) {
    const normalized = String(token || "").trim();
    if (!normalized) return null;
    return database
      .prepare(
        `SELECT i.*, t.title AS trip_title
         FROM travel_invites i JOIN travel_trips t ON t.id = i.trip_id
         WHERE i.token_hash = ?`
      )
      .get(tokenHash(normalized));
  }

  function assertUsableInvite(invite) {
    if (!invite || invite.revoked_at) throw collabError("Invite not found.", 404);
    if (invite.expires_at && Date.parse(invite.expires_at) <= clock().getTime()) {
      throw collabError("This invite has expired.", 410);
    }
    if (invite.invite_type === "one_time" && invite.accepted_at) {
      throw collabError("This invite has already been used.", 410);
    }
  }

  function createInvite(tripId, userId, input = {}) {
    assertMember(tripId, userId, true);
    const inviteType = input.type === "reusable" ? "reusable" : "one_time";
    const email = normalizeEmail(input.email);
    if (inviteType === "reusable" && email) {
      throw collabError("Reusable invites cannot be email-bound.", 400);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw collabError("A valid invite email is required.", 400);
    }
    let expiresAt = null;
    if (input.expiresAt) {
      const timestamp = Date.parse(input.expiresAt);
      if (!Number.isFinite(timestamp) || timestamp <= clock().getTime()) {
        throw collabError("expiresAt must be a future date.", 400);
      }
      expiresAt = new Date(timestamp).toISOString();
    }
    return transaction(() => {
      assertRevision(tripRow(tripId), input.baseRevision);
      const token = crypto.randomBytes(32).toString("base64url");
      const id = uid();
      const createdAt = currentIso();
      database
        .prepare(
          `INSERT INTO travel_invites
            (id, trip_id, token_hash, invite_type, email, created_by, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, tripId, tokenHash(token), inviteType, email || null, normalizeUserId(userId), expiresAt, createdAt);
      return {
        invite: { id, tripId, type: inviteType, email: email || null, token, expiresAt, createdAt },
        revision: bumpRevision(tripId),
      };
    });
  }

  function listInvites(tripId, userId) {
    assertMember(tripId, userId, true);
    return database
      .prepare(
        `SELECT id, trip_id AS tripId, invite_type AS type, email, created_by AS createdBy,
                expires_at AS expiresAt, created_at AS createdAt, revoked_at AS revokedAt,
                accepted_at AS acceptedAt
         FROM travel_invites WHERE trip_id = ? ORDER BY created_at DESC`
      )
      .all(tripId);
  }

  function revokeInvite(tripId, inviteId, userId, baseRevision) {
    assertMember(tripId, userId, true);
    return transaction(() => {
      assertRevision(tripRow(tripId), baseRevision);
      const result = database
        .prepare(
          `UPDATE travel_invites SET revoked_at = ?
           WHERE id = ? AND trip_id = ? AND revoked_at IS NULL`
        )
        .run(currentIso(), inviteId, tripId);
      if (!result.changes) throw collabError("Invite not found or already revoked.", 404);
      return { revoked: true, revision: bumpRevision(tripId) };
    });
  }

  function previewInvite(token) {
    const invite = inviteByToken(token);
    assertUsableInvite(invite);
    return {
      tripTitle: invite.trip_title,
      type: invite.invite_type,
      emailBound: Boolean(invite.email),
      expiresAt: invite.expires_at || null,
      role: "editor",
    };
  }

  function acceptInvite(token, userId, userLabel) {
    const actorId = normalizeUserId(userId);
    if (!actorId) throw collabError("A Google account is required.", 401);
    return transaction(() => {
      const invite = inviteByToken(token);
      assertUsableInvite(invite);
      if (invite.email && invite.email !== actorId) {
        throw collabError("This invite is bound to a different Google account.", 403);
      }
      const existing = membership(invite.trip_id, actorId);
      if (!existing) {
        database
          .prepare(
            `INSERT INTO travel_trip_members (trip_id, user_id, role, label, joined_at)
             VALUES (?, ?, 'editor', ?, ?)`
          )
          .run(
            invite.trip_id,
            actorId,
            String(userLabel || actorId).trim() || actorId,
            currentIso()
          );
      }
      if (invite.invite_type === "one_time") {
        database
          .prepare("UPDATE travel_invites SET accepted_at = ? WHERE id = ?")
          .run(currentIso(), invite.id);
      }
      const revision = bumpRevision(invite.trip_id);
      return {
        trip: mapTrip(tripRow(invite.trip_id), membership(invite.trip_id, actorId).role),
        revision,
        alreadyMember: Boolean(existing),
      };
    });
  }

  return {
    acceptInvite,
    createInvite,
    createReservation,
    createStop,
    createTrip,
    deleteReservation,
    deleteStop,
    deleteTrip,
    getTrip,
    importReservations,
    listInvites,
    listMembers,
    listReservations,
    listStops,
    listTrips,
    previewInvite,
    removeMember,
    revokeInvite,
    updateReservation,
    updateStop,
    updateTrip,
  };
}

let defaultStore;

function getTravelCollabStore() {
  if (!defaultStore) defaultStore = createTravelCollabStore();
  return defaultStore;
}

module.exports = {
  collabError,
  createTravelCollabStore,
  ensureTravelCollabTables,
  getTravelCollabStore,
  normalizeUserId,
  nowIso,
};
