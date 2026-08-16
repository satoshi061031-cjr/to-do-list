const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createTravelCollabStore } = require("../server/travel-collab-store");

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const store = createTravelCollabStore({ database });
  const trip = store.createTrip({
    ownerUserId: "owner@example.com",
    ownerLabel: "Owner",
    title: "Kyoto",
    data: { destination: "Japan" },
  });
  return { database, store, trip };
}

test("trip ACL grants editors content access but reserves administration for owner", () => {
  const { database, store, trip } = fixture();
  try {
    const invite = store.createInvite(trip.id, "owner@example.com", {
      type: "reusable",
      baseRevision: trip.revision,
    });
    const accepted = store.acceptInvite(invite.invite.token, "EDITOR@example.com", "Editor");

    assert.equal(accepted.trip.role, "editor");
    const stop = store.createStop(trip.id, "editor@example.com", {
      data: { name: "Fushimi Inari" },
      baseRevision: accepted.revision,
    });
    assert.equal(stop.stop.data.name, "Fushimi Inari");
    assert.throws(
      () => store.createInvite(trip.id, "editor@example.com", { type: "reusable" }),
      (error) => error.statusCode === 403
    );
    assert.throws(
      () => store.getTrip(trip.id, "stranger@example.com"),
      (error) => error.statusCode === 404
    );
  } finally {
    database.close();
  }
});

test("revisions increment and stale mutations return a conflict", () => {
  const { database, store, trip } = fixture();
  try {
    const changed = store.updateTrip(trip.id, "owner@example.com", {
      title: "Kyoto Spring",
      baseRevision: 1,
    });
    assert.equal(changed.revision, 2);
    assert.deepEqual(store.getTrip(trip.id, "owner@example.com", { revision: 2 }), {
      id: trip.id,
      revision: 2,
      unchanged: true,
    });
    assert.throws(
      () =>
        store.createStop(trip.id, "owner@example.com", {
          data: { name: "Station" },
          baseRevision: 1,
        }),
      (error) => error.statusCode === 409 && error.code === "STALE_REVISION"
    );
    assert.equal(store.getTrip(trip.id, "owner@example.com").revision, 2);
  } finally {
    database.close();
  }
});

test("reservation import deduplicates sourceId within a trip", () => {
  const { database, store, trip } = fixture();
  try {
    const imported = store.importReservations(trip.id, "owner@example.com", {
      baseRevision: 1,
      reservations: [
        { sourceId: "gmail:abc", data: { kind: "flight" } },
        { sourceId: "gmail:abc", data: { kind: "duplicate" } },
        { sourceId: "gmail:def", data: { kind: "hotel" } },
      ],
    });
    assert.equal(imported.imported.length, 2);
    assert.equal(imported.duplicates.length, 1);
    assert.equal(imported.revision, 2);
    assert.equal(store.listReservations(trip.id, "owner@example.com").length, 2);
    assert.throws(
      () =>
        store.createReservation(trip.id, "owner@example.com", {
          sourceId: "gmail:abc",
          data: {},
          baseRevision: 2,
        }),
      (error) => error.statusCode === 409 && error.code === "DUPLICATE_SOURCE_ID"
    );
  } finally {
    database.close();
  }
});

test("one-time invites can be email-bound and cannot be reused", () => {
  const { database, store, trip } = fixture();
  try {
    const created = store.createInvite(trip.id, "owner@example.com", {
      type: "one_time",
      email: "guest@example.com",
      baseRevision: 1,
    });
    assert.ok(created.invite.token.length >= 40);
    assert.deepEqual(store.previewInvite(created.invite.token), {
      tripTitle: "Kyoto",
      type: "one_time",
      emailBound: true,
      expiresAt: null,
      role: "editor",
    });
    assert.throws(
      () => store.acceptInvite(created.invite.token, "other@example.com", "Other"),
      (error) => error.statusCode === 403
    );
    const accepted = store.acceptInvite(created.invite.token, "guest@example.com", "Guest");
    assert.equal(accepted.trip.role, "editor");
    assert.throws(
      () => store.acceptInvite(created.invite.token, "guest@example.com", "Guest"),
      (error) => error.statusCode === 410
    );
  } finally {
    database.close();
  }
});

test("reusable invites accept multiple Google identities until revoked", () => {
  const { database, store, trip } = fixture();
  try {
    const created = store.createInvite(trip.id, "owner@example.com", {
      type: "reusable",
      baseRevision: 1,
    });
    const first = store.acceptInvite(created.invite.token, "a@example.com", "A");
    const second = store.acceptInvite(created.invite.token, "b@example.com", "B");
    assert.equal(second.revision, first.revision + 1);

    const revoked = store.revokeInvite(
      trip.id,
      created.invite.id,
      "owner@example.com",
      second.revision
    );
    assert.equal(revoked.revoked, true);
    assert.throws(
      () => store.previewInvite(created.invite.token),
      (error) => error.statusCode === 404
    );
  } finally {
    database.close();
  }
});

test("createStop keeps a client-supplied id for optimistic updates", () => {
  const { database, store, trip } = fixture();
  try {
    const created = store.createStop(trip.id, "owner@example.com", {
      id: "stop-client-1",
      data: { title: "Kiyomizu" },
      baseRevision: 1,
    });
    assert.equal(created.stop.id, "stop-client-1");
    assert.equal(created.stop.data.title, "Kiyomizu");
  } finally {
    database.close();
  }
});

test("only owners can remove members", () => {
  const { database, store, trip } = fixture();
  try {
    const invite = store.createInvite(trip.id, "owner@example.com", {
      type: "reusable",
      baseRevision: 1,
    });
    const joined = store.acceptInvite(invite.invite.token, "editor@example.com", "Editor");
    assert.throws(
      () =>
        store.removeMember(
          trip.id,
          "owner@example.com",
          "editor@example.com",
          joined.revision
        ),
      (error) => error.statusCode === 403
    );
    const removed = store.removeMember(
      trip.id,
      "editor@example.com",
      "owner@example.com",
      joined.revision
    );
    assert.equal(removed.removed, true);
  } finally {
    database.close();
  }
});
