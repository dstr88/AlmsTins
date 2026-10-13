-- Rename dirty_tins and dirty_tin_entries to petro_tins / petro_tin_entries
ALTER TABLE dirty_tins      RENAME TO petro_tins;
ALTER TABLE dirty_tin_entries RENAME TO petro_tin_entries;
