(() => {
  const CONTRACT_ID = "chatgpt-current-2026-10-12-v1";
  const CONTRACT_HASH = "7bc4117efd3a32e99b17defb2809a630db3f2f951e01035af623e143bc1b9538";
  const CONTRACT_VERSION = 1;
  const CURRENT_TURN_SELECTOR = "section[data-testid^='conversation-turn-']";
  const FIXTURE_TURN_SELECTOR = "[data-testid^='conversation-turn-']";
  const ROLE_SELECTOR = "[data-message-author-role]";
  const ASSISTANT_ROLE_SELECTOR = "[data-message-author-role='assistant']";
  const COPY_ACTION_SELECTOR = "[data-testid='copy-turn-action-button']";
  const COMPOSER_SELECTORS = [
    "#prompt-textarea[role='textbox'][contenteditable='true']",
    "textarea#mobile-composer-prompt"
  ];
  const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  function isFixture(doc) {
    return doc?.documentElement?.dataset?.micaFixture === "true";
  }

  function isSupportedDocument(doc) {
    return !!doc && (SUPPORTED_HOSTS.has(doc.location?.hostname) || isFixture(doc));
  }

  function listTurns(doc = document) {
    return inspectTurnCandidates(doc).turns;
  }

  function inspectTurnCandidates(doc = document) {
    if (!isSupportedDocument(doc)) return { turns: [], invalid: [], candidateCount: 0 };
    const selector = isFixture(doc) ? FIXTURE_TURN_SELECTOR : CURRENT_TURN_SELECTOR;
    const candidates = Array.from(doc.querySelectorAll(selector));
    const turns = [];
    const invalid = [];
    const seen = new Set();
    for (const element of candidates) {
      if (!(element instanceof HTMLElement) || seen.has(element)) {
        invalid.push({ reason: "invalid or duplicate turn container" });
        continue;
      }
      const roleNodes = Array.from(element.querySelectorAll(ROLE_SELECTOR)).filter((node) => node.closest(selector) === element);
      if (roleNodes.length !== 1) {
        invalid.push({ turnId: element.getAttribute("data-testid"), reason: "turn must have exactly one role owner" });
        continue;
      }
      const roleNode = roleNodes[0];
      const role = roleNode.getAttribute("data-message-author-role");
      if (role !== "user" && role !== "assistant") {
        invalid.push({ turnId: element.getAttribute("data-testid"), reason: `unproven turn role: ${role || "missing"}` });
        continue;
      }
      const turnId = element.getAttribute("data-testid") || `mica-turn-${turns.length + 1}`;
      turns.push({
        turnId,
        order: turns.length,
        role,
        element,
        roleElement: roleNode,
        answerRoot: role === "assistant" ? findAnswerRoot(roleNode) : null,
        variantId: isFixture(doc) ? "fixture-turn-section-role-v1" : "conversation-turn-section-role-v1"
      });
      seen.add(element);
    }
    return { turns, invalid, candidateCount: candidates.length };
  }

  function findAnswerRoot(roleNode) {
    if (!(roleNode instanceof HTMLElement)) return null;
    return roleNode.querySelector(":scope > .markdown, :scope > [data-message-content], :scope > .prose") || roleNode;
  }

  function findComposer(doc = document) {
    if (!isSupportedDocument(doc)) return null;
    for (const selector of COMPOSER_SELECTORS) {
      const candidate = doc.querySelector(selector);
      if (!(candidate instanceof HTMLElement)) continue;
      if (candidate instanceof HTMLTextAreaElement) {
        return { element: candidate, variantId: "mobile-composer-textarea-v1" };
      }
      if (candidate.getAttribute("role") === "textbox" && candidate.isContentEditable) {
        return { element: candidate, variantId: "prompt-textarea-contenteditable-v1" };
      }
    }
    return null;
  }

  function findAssistantActionCluster(turn) {
    if (!turn || turn.role !== "assistant" || !(turn.element instanceof HTMLElement)) return null;
    if (!isFixture(turn.element.ownerDocument)) return null;
    const action = turn.element.querySelector(COPY_ACTION_SELECTOR);
    if (!(action instanceof HTMLElement) || !turn.element.contains(action)) return null;
    const cluster = action.parentElement;
    if (!(cluster instanceof HTMLElement) || !turn.element.contains(cluster)) return null;
    return {
      action,
      cluster,
      variantId: "native-copy-button-parent-v1",
      insertion: "sibling-after-native-copy"
    };
  }

  function generationStateForTurn(turn) {
    if (!turn || turn.role !== "assistant" || !(turn.element instanceof HTMLElement)) return null;
    if (!isFixture(turn.element.ownerDocument)) return null;
    const state = turn.element.dataset.micaGenerationState;
    return state === "STREAMING" || state === "SETTLED" ? state : null;
  }

  function inspect(doc = document) {
    if (!isSupportedDocument(doc)) {
      return inspection("UNSUPPORTED", "This page is not a supported ChatGPT surface.", []);
    }

    const broadRoleCount = doc.querySelectorAll(ROLE_SELECTOR).length;
    const turnInspection = inspectTurnCandidates(doc);
    const turns = turnInspection.turns;
    const turnStructureValid = turnInspection.invalid.length === 0;
    const assistantTurns = turns.filter((turn) => turn.role === "assistant" && turn.answerRoot);
    const composer = findComposer(doc);
    const actionClusters = assistantTurns.map(findAssistantActionCluster).filter(Boolean);
    const capabilities = [
      capability("turns.list", "conversation-turn-section-role-v1", turns.length > 0 && turnStructureValid ? "EXACT" : "UNKNOWN", [
        "ordered turn container",
        "exactly one role owner",
        "user or assistant role"
      ], turns.length > 0 && turnStructureValid ? null : turnInspection.invalid[0]?.reason || "No contract-valid turn was observed."),
      capability("answer.read", "assistant-role-semantic-content-v1", assistantTurns.length > 0 ? "EXACT" : "UNKNOWN", [
        "assistant role ownership",
        "semantic content root"
      ], assistantTurns.length > 0 ? null : "No contract-valid assistant answer was observed."),
      capability("answer.actionCluster", actionClusters.length > 0 ? "native-copy-button-parent-v1" : "unproven-v1", actionClusters.length > 0 ? "EXACT" : "UNKNOWN", actionClusters.length > 0 ? [
        "native copy button",
        "same assistant turn",
        "sibling cluster parent"
      ] : [], actionClusters.length > 0 ? null : "Current-site action-cluster placement is not proven; Mica will not inject."),
      capability("composer.editor", composer?.variantId || "prompt-editor-current-variants-v1", composer ? (isFixture(doc) ? "EXACT" : "COMPATIBLE") : "UNKNOWN", composer ? [
        "prompt editor identity",
        "authoritative editor property"
      ] : [], composer ? null : "No contract-valid composer was observed."),
      capability("conversation.scrollRoot", "unproven-v1", "UNKNOWN", [], "Current scroll-root restoration contract is not yet proven."),
      capability("answer.math", "unproven-v1", "UNKNOWN", [], "Current ChatGPT math structure is not yet proven."),
      capability("lifecycle.streamingEditBranchTools", "unproven-v1", "UNKNOWN", [], "Current lifecycle contract is not yet proven.")
    ];

    if (!turnStructureValid) {
      return inspection("UNKNOWN", "At least one conversation turn does not match the frozen role/ownership contract.", capabilities, turns, composer);
    }
    if (turns.length > 0 && assistantTurns.length > 0 && composer) {
      return inspection(isFixture(doc) ? "EXACT" : "COMPATIBLE", "Current conversation structure matches a proven contract variant.", capabilities, turns, composer);
    }
    if (turns.length > 0 && assistantTurns.length > 0) {
      return inspection("COMPATIBLE", "Conversation content is supported; an optional surface is unavailable.", capabilities, turns, composer);
    }
    if (broadRoleCount > 0) {
      return inspection("UNKNOWN", "ChatGPT content was found, but its structure does not match the frozen contract.", capabilities, turns, composer);
    }
    return inspection("CONTENT_UNAVAILABLE", "Open a ChatGPT conversation to check page support.", capabilities, turns, composer);
  }

  function capability(capabilityId, variantId, status, observedInvariants, reason) {
    return {
      capabilityId,
      variantId,
      status,
      observedInvariants,
      contractHash: CONTRACT_HASH,
      invalidatedBy: reason ? [reason] : [],
      failOpen: status === "UNKNOWN"
    };
  }

  function inspection(status, reason, capabilities, turns = [], composer = null) {
    return {
      status,
      reason,
      contractId: CONTRACT_ID,
      contractHash: CONTRACT_HASH,
      contractVersion: CONTRACT_VERSION,
      capabilities,
      turns,
      composer,
      observedAt: new Date().toISOString()
    };
  }

  globalThis.MicaChatGPTAdapter = Object.freeze({
    contractId: CONTRACT_ID,
    contractHash: CONTRACT_HASH,
    contractVersion: CONTRACT_VERSION,
    inspect,
    listTurns,
    findComposer,
    findAssistantActionCluster,
    generationStateForTurn
  });
})();
