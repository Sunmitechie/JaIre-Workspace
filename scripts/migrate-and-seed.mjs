import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    console.log("Creating enums...");
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE workspace_type AS ENUM ('hot_desk','private_suite','meeting_room','lounge');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE booking_status AS ENUM ('pending','active','completed','cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_method AS ENUM ('paystack','roqqu','usdc_wallet');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_provider AS ENUM ('paystack','stripe');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE payment_status AS ENUM ('pending','success','failed','abandoned');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE event_type AS ENUM ('check_in','check_out','payment','wallet_funded','booking_cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    console.log("Creating tables...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        capacity INTEGER NOT NULL DEFAULT 1,
        hourly_rate_ngn REAL NOT NULL,
        hourly_rate_usdc REAL NOT NULL,
        amenities TEXT NOT NULL DEFAULT '[]',
        image_url TEXT,
        is_available BOOLEAN NOT NULL DEFAULT true,
        workspace_type workspace_type NOT NULL DEFAULT 'hot_desk',
        floor INTEGER NOT NULL DEFAULT 1,
        qr_secret TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        name TEXT,
        wallet_address TEXT,
        verifier_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        user_id TEXT NOT NULL DEFAULT 'guest',
        user_name TEXT NOT NULL DEFAULT 'Guest',
        user_email TEXT,
        status booking_status NOT NULL DEFAULT 'pending',
        check_in_time TIMESTAMP,
        check_out_time TIMESTAMP,
        planned_duration_hours REAL NOT NULL DEFAULT 1,
        actual_duration_seconds INTEGER,
        escrow_amount_usdc REAL,
        billed_amount_usdc REAL,
        refunded_amount_usdc REAL,
        escrow_account TEXT,
        transaction_signature TEXT,
        escrow_tx_signature TEXT,
        settlement_tx_signature TEXT,
        payment_method payment_method NOT NULL DEFAULT 'paystack',
        ngn_amount_paid REAL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_id TEXT,
        user_email TEXT NOT NULL,
        user_wallet_address TEXT,
        amount_ngn REAL NOT NULL,
        amount_usdc REAL NOT NULL,
        fx_rate REAL NOT NULL DEFAULT 1600,
        fx_spread_pct REAL NOT NULL DEFAULT 0.5,
        reference TEXT NOT NULL UNIQUE,
        provider payment_provider NOT NULL DEFAULT 'paystack',
        status payment_status NOT NULL DEFAULT 'pending',
        tx_signature TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type event_type NOT NULL,
        workspace_id TEXT,
        workspace_name TEXT,
        user_id TEXT,
        user_name TEXT,
        amount_usdc REAL,
        amount_ngn REAL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      );
    `);

    console.log("Seeding workspaces...");
    const JAIRE_RATE = 1608;
    const workspaces = [
      {
        id: "ws-001",
        name: "The Hub — Open Floor",
        description: "Vibrant open coworking area with high-speed Wi-Fi, natural lighting, and a buzzing community of builders.",
        amenities: ["High-speed Wi-Fi", "Power outlets", "Coffee bar", "Printing", "Lockers"],
        capacity: 40,
        hourly_rate_ngn: 1500,
        workspace_type: "hot_desk",
        floor: 1,
      },
      {
        id: "ws-002",
        name: "Founders Suite — Private Office",
        description: "Fully equipped private office for focused deep work. Perfect for solo founders and small teams.",
        amenities: ["Dedicated desk", "Meeting room access", "High-speed Wi-Fi", "Climate control", "Whiteboard"],
        capacity: 4,
        hourly_rate_ngn: 3500,
        workspace_type: "private_suite",
        floor: 2,
      },
      {
        id: "ws-003",
        name: "Blockchain Lounge — Crypto Corner",
        description: "Our signature space for Web3 builders — multiple monitors, fast internet, and a community of on-chain natives.",
        amenities: ["Dual monitors", "Ultra-fast Wi-Fi (1Gbps)", "Hardware wallet-friendly setup", "24/7 access", "Community Slack"],
        capacity: 12,
        hourly_rate_ngn: 2500,
        workspace_type: "lounge",
        floor: 1,
      },
      {
        id: "ws-004",
        name: "Board Room — Premium Meeting",
        description: "Impress your clients and investors in our premium conference room with AV setup and whiteboard wall.",
        amenities: ["Projector & screen", "Video conferencing (Zoom/Meet)", "Whiteboard wall", "Catering available", "Receptionist support"],
        capacity: 12,
        hourly_rate_ngn: 8000,
        workspace_type: "meeting_room",
        floor: 3,
      },
    ];

    for (const ws of workspaces) {
      await client.query(`
        INSERT INTO workspaces (id, name, description, capacity, hourly_rate_ngn, hourly_rate_usdc, amenities, workspace_type, floor, is_available)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::workspace_type, $9, true)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          hourly_rate_ngn = EXCLUDED.hourly_rate_ngn,
          hourly_rate_usdc = EXCLUDED.hourly_rate_usdc,
          amenities = EXCLUDED.amenities,
          is_available = true
      `, [
        ws.id,
        ws.name,
        ws.description,
        ws.capacity,
        ws.hourly_rate_ngn,
        parseFloat((ws.hourly_rate_ngn / JAIRE_RATE).toFixed(6)),
        JSON.stringify(ws.amenities),
        ws.workspace_type,
        ws.floor,
      ]);
      console.log(`  ✓ ${ws.id}: ${ws.name}`);
    }

    console.log("\n✅ Migration and seed complete!");
    const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'jaire_%' AND table_name NOT LIKE 'hub_%' ORDER BY table_name");
    console.log("Tables:", result.rows.map(r => r.table_name).join(", "));

  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(e => { console.error("MIGRATION FAILED:", e.message); process.exit(1); });
