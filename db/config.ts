// db/config.ts
import { defineDb, defineTable, column } from 'astro:db';

export const Lead = defineTable({
  columns: {
    id: column.text({ primaryKey: true }),
    name: column.text(),
    email: column.text(),
    phone: column.text({ optional: true }),
    city: column.text({ optional: true }),
    state: column.text({ optional: true }),
    comments: column.text({ optional: true }),

    hasWebsite: column.boolean({ optional: true }),

    // ✅ New canonical storage: JSON string (e.g. '["https://a","https://b"]')
    websites: column.text({ optional: true }),

    // 💤 Old columns kept only to satisfy the migration checker:
    website1: column.text({ optional: true, deprecated: true }),
    website2: column.text({ optional: true, deprecated: true }),
    website3: column.text({ optional: true, deprecated: true }),

    createdAt: column.date({ optional: true }),
  },
});

export default defineDb({ tables: { Lead } });
