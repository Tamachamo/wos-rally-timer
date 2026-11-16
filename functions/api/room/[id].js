export async function onRequestGet(context) {
  const { params, env } = context;
  const roomId = params.id;

  if (!env.DB) {
    return new Response(JSON.stringify({ error: "D1 database 'DB' is not bound." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const row = await env.DB.prepare(
    "SELECT state, updated_at FROM rooms WHERE room_id = ?"
  ).bind(roomId).first();

  if (!row) {
    return new Response(JSON.stringify({ cities: null, updatedAt: 0 }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(
    JSON.stringify({
      cities: JSON.parse(row.state),
      updatedAt: row.updated_at
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

export async function onRequestPost(context) {
  const { params, request, env } = context;
  const roomId = params.id;

  if (!env.DB) {
    return new Response(JSON.stringify({ error: "D1 database 'DB' is not bound." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const body = await request.json();
  const stateJson = JSON.stringify(body.cities || []);
  const updatedAt = body.updatedAt || Date.now();

  await env.DB.prepare(
    `INSERT INTO rooms (room_id, state, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET
       state = excluded.state,
       updated_at = excluded.updated_at`
  ).bind(roomId, stateJson, updatedAt).run();

  return new Response(JSON.stringify({ ok: true, updatedAt }), {
    headers: { "Content-Type": "application/json" }
  });
}
