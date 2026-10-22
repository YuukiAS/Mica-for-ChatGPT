(() => {
  const HIGHLIGHT_BACKUP_SCHEMA_VERSION = 2;
  const settingsModel = globalThis.MicaSettingsModel;
  const chatgptModel = globalThis.MicaHighlightEngine;
  const generalWebModel = globalThis.MicaGeneralWebHighlightModel;
  const SETTINGS_FILE_BYTES = settingsModel?.maxImportChars || 256 * 1024;
  const HIGHLIGHT_FILE_BYTES = (chatgptModel?.maxImportChars || 32 * 1024 * 1024)
    + (generalWebModel?.maxImportChars || 8 * 1024 * 1024);
  const COMBINED_KEYS = Object.freeze(["schemaVersion", "exportedAt", "chatgptRecords", "generalWebRecords"]);

  function inspectFile(file, kind) {
    const limit = kind === "settings" ? SETTINGS_FILE_BYTES : kind === "highlights" ? HIGHLIGHT_FILE_BYTES : 0;
    if (!limit) return { ok: false, reason: "import_kind_unsupported", limitBytes: 0 };
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size < 0) return { ok: false, reason: "import_file_size_unknown", limitBytes: limit };
    if (size > limit) return { ok: false, reason: `${kind}_import_too_large`, limitBytes: limit };
    return { ok: true, limitBytes: limit };
  }

  async function readFile(file, kind) {
    const inspected = inspectFile(file, kind);
    if (!inspected.ok) return inspected;
    if (typeof file?.text !== "function") return { ok: false, reason: "import_file_unreadable", limitBytes: inspected.limitBytes };
    try {
      const text = await file.text();
      if (typeof text !== "string") return { ok: false, reason: "import_file_unreadable", limitBytes: inspected.limitBytes };
      return { ok: true, text, limitBytes: inspected.limitBytes };
    } catch (_error) {
      return { ok: false, reason: "import_file_unreadable", limitBytes: inspected.limitBytes };
    }
  }

  function createHighlightBackup(chatgptRecords, generalWebRecords, exportedAt = new Date().toISOString()) {
    return {
      schemaVersion: HIGHLIGHT_BACKUP_SCHEMA_VERSION,
      exportedAt: validTimestamp(exportedAt) ? exportedAt : new Date().toISOString(),
      chatgptRecords: chatgptModel.sanitizeRecords(chatgptRecords),
      generalWebRecords: generalWebModel.sanitizeRecords(generalWebRecords)
    };
  }

  function parseHighlightBackup(source) {
    const serialized = typeof source === "string" ? source : String(source || "");
    if (serialized.length > HIGHLIGHT_FILE_BYTES) return { ok: false, reason: "highlights_import_too_large" };
    let parsed;
    try {
      parsed = JSON.parse(serialized);
    } catch (_error) {
      return { ok: false, reason: "highlights_invalid_json" };
    }

    const combined = isRecord(parsed) && ("chatgptRecords" in parsed || "generalWebRecords" in parsed);
    if (combined) return parseCombined(parsed);

    const records = Array.isArray(parsed) ? parsed : parsed?.records;
    if (!Array.isArray(records)) return { ok: false, reason: "highlight_records_missing" };
    const families = new Set(records.map(recordFamily).filter(Boolean));
    if (families.size > 1) return { ok: false, reason: "legacy_highlight_families_mixed" };
    const isGeneralWeb = families.has("general-web");
    const imported = isGeneralWeb ? generalWebModel.importJson(serialized) : chatgptModel.importJson(serialized);
    if (!imported.ok) return imported;
    return {
      ok: true,
      format: isGeneralWeb ? "legacy-general-web-v1" : "legacy-chatgpt-v1",
      chatgptRecords: isGeneralWeb ? null : imported.records,
      generalWebRecords: isGeneralWeb ? imported.records : null,
      importedCount: imported.records.length,
      rejectedCount: imported.rejectedCount
    };
  }

  function parseCombined(parsed) {
    if (parsed.schemaVersion !== HIGHLIGHT_BACKUP_SCHEMA_VERSION) return { ok: false, reason: "highlight_backup_schema_unsupported" };
    if (!validTimestamp(parsed.exportedAt)) return { ok: false, reason: "highlight_backup_timestamp_invalid" };
    if (!exactKeys(parsed, COMBINED_KEYS)) return { ok: false, reason: "highlight_backup_envelope_invalid" };
    if (!Array.isArray(parsed.chatgptRecords) || !Array.isArray(parsed.generalWebRecords)) {
      return { ok: false, reason: "highlight_backup_records_missing" };
    }
    if (parsed.chatgptRecords.length > chatgptModel.maxImportSourceRecords
      || parsed.generalWebRecords.length > generalWebModel.maxImportSourceRecords) {
      return { ok: false, reason: "highlight_backup_record_count_exceeded" };
    }
    const chatgptRecords = chatgptModel.sanitizeRecords(parsed.chatgptRecords);
    const generalWebRecords = generalWebModel.sanitizeRecords(parsed.generalWebRecords);
    const sourceCount = parsed.chatgptRecords.length + parsed.generalWebRecords.length;
    const importedCount = chatgptRecords.length + generalWebRecords.length;
    if (sourceCount > 0 && importedCount === 0) return { ok: false, reason: "highlight_backup_records_invalid" };
    return {
      ok: true,
      format: "combined-v2",
      chatgptRecords,
      generalWebRecords,
      importedCount,
      rejectedCount: sourceCount - importedCount
    };
  }

  function recordFamily(record) {
    const id = typeof record?.id === "string" ? record.id : "";
    if (/^web-highlight-/.test(id)) return "general-web";
    if (/^highlight-/.test(id)) return "chatgpt";
    return null;
  }

  function exactKeys(value, allowed) {
    const keys = Object.keys(value).sort();
    return keys.length === allowed.length && keys.every((key, index) => key === [...allowed].sort()[index]);
  }

  function validTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  globalThis.MicaLocalImportModel = Object.freeze({
    highlightBackupSchemaVersion: HIGHLIGHT_BACKUP_SCHEMA_VERSION,
    settingsFileBytes: SETTINGS_FILE_BYTES,
    highlightFileBytes: HIGHLIGHT_FILE_BYTES,
    inspectFile,
    readFile,
    createHighlightBackup,
    parseHighlightBackup
  });
})();
