(() => {
  const MODEL_VERSION = 1;
  const MAX_TURNS = 20000;

  function collect(options = {}) {
    const inspection = options.inspection;
    const proof = sanitizeCompletenessProof(options.completenessProof);
    const conversationId = String(options.conversationId || "");
    if (!inspection || !Array.isArray(inspection.turns)) return failure("turn_inspection_unavailable");
    if (!proof) return failure("conversation_completeness_unproven");
    if (proof.conversationId !== conversationId) return failure("conversation_identity_mismatch");
    const exactTurns = inspection.capabilities?.find((item) => item.capabilityId === "turns.list")?.status === "EXACT";
    if (!exactTurns) return failure("turn_contract_not_exact");
    const turns = inspection.turns;
    if (turns.length !== proof.expectedTurnCount) return failure("turn_count_mismatch", { expectedTurnCount: proof.expectedTurnCount, observedTurnCount: turns.length });
    if (turns.length < 1 || turns.length > MAX_TURNS) return failure("turn_count_unsupported");
    if (new Set(turns.map((turn) => turn.turnId)).size !== turns.length) return failure("turn_identity_duplicate");
    if (turns.some((turn, index) => turn.order !== index || !["user", "assistant"].includes(turn.role))) return failure("turn_order_invalid");
    const observedRoleSequenceHash = roleSequenceHash(turns);
    if (observedRoleSequenceHash !== proof.roleSequenceHash) return failure("turn_role_sequence_mismatch");
    if (typeof options.createDocument !== "function") return failure("document_factory_unavailable");

    const entries = [];
    for (const turn of turns) {
      const documentModel = options.createDocument(turn);
      if (!documentModel?.durable || documentModel.generationState !== "SETTLED") return failure(turn.role === "assistant" ? "assistant_not_settled" : "user_turn_unavailable", { turnId: turn.turnId });
      if (documentModel.role !== turn.role || documentModel.turnId !== turn.turnId || documentModel.conversationId !== conversationId) return failure("document_identity_mismatch", { turnId: turn.turnId });
      if (documentModel.producedBy !== "MicaChatGPTAdapter") return failure("document_producer_unproven", { turnId: turn.turnId });
      if (!Array.isArray(documentModel.orderedBlocks) || documentModel.orderedBlocks.length === 0) return failure("turn_document_empty", { turnId: turn.turnId });
      if (documentHasUnsupportedContent(documentModel)) return failure("turn_document_incomplete", { turnId: turn.turnId });
      entries.push({ role: turn.role, turnId: turn.turnId, order: turn.order, document: documentModel });
    }
    if (new Set(entries.map((entry) => entry.document.documentId)).size !== entries.length) return failure("document_identity_duplicate");
    if (!entries.some((entry) => entry.role === "assistant")) return failure("conversation_has_no_assistant_answer");
    const turnSequenceHash = sequenceHash(entries);
    const completionProof = {
      schemaVersion: MODEL_VERSION,
      status: "EXACT",
      source: proof.source,
      conversationId,
      selectedTurnCount: entries.length,
      expectedTurnCount: proof.expectedTurnCount,
      roleSequenceHash: proof.roleSequenceHash,
      turnSequenceHash,
      capturedAt: proof.capturedAt
    };
    return {
      ok: true,
      bundle: {
        schemaVersion: MODEL_VERSION,
        bundleId: `conversation-export-${hashText(`${conversationId}:${turnSequenceHash}`)}`,
        conversationId,
        entries,
        completionProof,
        completeSelection: true,
        localOnly: true
      }
    };
  }

  function validateBundle(value) {
    if (value?.schemaVersion !== MODEL_VERSION || value.completeSelection !== true || value.localOnly !== true) return failure("conversation_bundle_invalid");
    if (!/^conversation-[a-f0-9]{8}$/.test(value.conversationId || "")) return failure("conversation_bundle_invalid");
    if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > MAX_TURNS) return failure("conversation_entries_invalid");
    const proof = value.completionProof;
    if (proof?.schemaVersion !== MODEL_VERSION || proof.status !== "EXACT" || proof.source !== "validated-conversation-graph" || proof.conversationId !== value.conversationId) return failure("conversation_completeness_unproven");
    if (proof.selectedTurnCount !== value.entries.length || proof.expectedTurnCount !== value.entries.length) return failure("conversation_turn_count_unproven");
    if (roleSequenceHash(value.entries) !== proof.roleSequenceHash || sequenceHash(value.entries) !== proof.turnSequenceHash) return failure("conversation_sequence_unproven");
    if (value.bundleId !== `conversation-export-${hashText(`${value.conversationId}:${proof.turnSequenceHash}`)}`) return failure("conversation_bundle_identity_invalid");
    if (new Set(value.entries.map((entry) => entry.turnId)).size !== value.entries.length) return failure("conversation_entry_identity_invalid");
    if (new Set(value.entries.map((entry) => entry.document?.documentId)).size !== value.entries.length) return failure("conversation_entry_identity_invalid");
    if (value.entries.some((entry, index) => entry.order !== index || !["user", "assistant"].includes(entry.role) || entry.document?.role !== entry.role || entry.document?.turnId !== entry.turnId || entry.document?.conversationId !== value.conversationId || entry.document?.producedBy !== "MicaChatGPTAdapter" || !entry.document?.durable || entry.document?.generationState !== "SETTLED" || !Array.isArray(entry.document?.orderedBlocks) || entry.document.orderedBlocks.length === 0 || documentHasUnsupportedContent(entry.document))) return failure("conversation_entry_identity_invalid");
    return { ok: true, bundle: value };
  }

  function documentHasUnsupportedContent(documentModel) {
    const supportedBlockKinds = new Set(["heading", "paragraph", "quote", "list", "table", "code", "display_math", "link", "citation", "image"]);
    const supportedInlineKinds = new Set(["text", "inline_code", "inline_math", "link", "citation", "image"]);
    const inlineGroups = [];
    for (const block of documentModel?.orderedBlocks || []) {
      if (!block || !supportedBlockKinds.has(block.kind)) return true;
      if (Array.isArray(block.inlines)) inlineGroups.push(block.inlines);
      for (const item of block.items || []) if (Array.isArray(item?.inlines)) inlineGroups.push(item.inlines);
      for (const row of block.cellInlines || []) for (const cell of row || []) if (Array.isArray(cell)) inlineGroups.push(cell);
    }
    return inlineGroups.some((runs) => runs.some((run) => !run || !supportedInlineKinds.has(run.kind)));
  }

  function readiness(options = {}) {
    if (options.enabled === false) return { ready: false, reason: "copy_export_disabled" };
    const proof = sanitizeCompletenessProof(options.completenessProof);
    if (!proof) return { ready: false, reason: options.lowMemoryActive ? "load_full_history_required" : "conversation_completeness_unproven" };
    if (proof.conversationId !== options.conversationId) return { ready: false, reason: "conversation_identity_mismatch" };
    if (options.lowMemoryActive) return { ready: false, reason: "load_full_history_required", expectedTurnCount: proof.expectedTurnCount };
    const turns = options.inspection?.turns || [];
    if (options.inspection?.capabilities?.find((item) => item.capabilityId === "turns.list")?.status !== "EXACT") return { ready: false, reason: "turn_contract_not_exact" };
    if (turns.length !== proof.expectedTurnCount) return { ready: false, reason: "turn_count_mismatch", expectedTurnCount: proof.expectedTurnCount, observedTurnCount: turns.length };
    if (roleSequenceHash(turns) !== proof.roleSequenceHash) return { ready: false, reason: "turn_role_sequence_mismatch" };
    return { ready: true, reason: "complete_range_proven", turnCount: turns.length, assistantCount: turns.filter((turn) => turn.role === "assistant").length };
  }

  function sanitizeCompletenessProof(value) {
    if (value?.schemaVersion !== MODEL_VERSION || value.source !== "validated-conversation-graph") return null;
    if (!Number.isInteger(value.expectedTurnCount) || value.expectedTurnCount < 1 || value.expectedTurnCount > MAX_TURNS) return null;
    if (!/^[a-f0-9]{8}$/.test(value.roleSequenceHash || "") || !/^conversation-[a-f0-9]{8}$/.test(value.conversationId || "")) return null;
    if (typeof value.capturedAt !== "string" || !Number.isFinite(Date.parse(value.capturedAt))) return null;
    return {
      schemaVersion: MODEL_VERSION,
      expectedTurnCount: value.expectedTurnCount,
      roleSequenceHash: value.roleSequenceHash,
      source: value.source,
      conversationId: value.conversationId,
      capturedAt: value.capturedAt
    };
  }

  function roleSequenceHash(turns) {
    return hashText((Array.isArray(turns) ? turns : []).map((turn) => turn?.role || "unknown").join("|"));
  }

  function sequenceHash(entries) {
    return hashText(entries.map((entry) => `${entry.order}:${entry.role}:${entry.turnId}:${entry.document?.documentId || ""}:${entry.document?.sourceVersion || ""}`).join("|"));
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function failure(reason, details = {}) {
    return { ok: false, reason, ...details, localOnly: true };
  }

  globalThis.MicaConversationExport = Object.freeze({ modelVersion: MODEL_VERSION, maxTurns: MAX_TURNS, collect, validateBundle, readiness, roleSequenceHash });
})();
