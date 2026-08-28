// One-off: fold held `pepper_treat` counts into `onigiri`.
//
//   MONGODB_URI=... MONGODB_DB=... node scripts/migrate-onigiri.ts
//
// The Pepper Treat left the catalog (SPEC §13.2), and the id went with it —
// old FEED events referencing it are already folded into a snapshot and never
// replayed, so nothing needs the id to survive. Inventories do: anyone
// holding treats would simply lose them.
//
// Idempotent by its filter: it only touches documents that still have the
// field, so a second run matches nothing. Delete this file once it has run
// everywhere it needs to.

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
if (!uri || !dbName) {
  console.error("MONGODB_URI and MONGODB_DB must both be set");
  process.exit(1);
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const caretakers = client.db(dbName).collection<{
    _id: string;
    inventory?: Partial<Record<string, number>>;
  }>("caretakers");

  const holders = await caretakers.find({ "inventory.pepper_treat": { $exists: true } }).toArray();
  if (holders.length === 0) {
    console.log("nothing to migrate — no caretaker is holding a pepper_treat");
  }

  let moved = 0;
  for (const holder of holders) {
    const count = holder.inventory?.pepper_treat ?? 0;
    // $inc rather than $set: a caretaker may already hold onigiri, and the
    // two stacks are the same item now.
    await caretakers.updateOne(
      { _id: holder._id },
      {
        ...(count > 0 ? { $inc: { "inventory.onigiri": count } } : {}),
        $unset: { "inventory.pepper_treat": "" },
      },
    );
    moved += count;
    console.log(count > 0 ? `${holder._id}: ${count} → onigiri` : `${holder._id}: cleared an empty entry`);
  }
  if (holders.length > 0) console.log(`migrated ${moved} treat(s) across ${holders.length} caretaker(s)`);
} finally {
  await client.close();
}
