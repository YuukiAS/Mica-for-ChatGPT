(() => {
  const CONTRACT_ID = "chatgpt-current-2026-10-12-v1";
  const CONTRACT_HASH = "__MICA_CHATGPT_CONTRACT_HASH__";
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
  const TOOL_STAGE_SELECTOR = "[data-testid*='tool'],[data-testid*='search'],[data-mica-tool-stage]";
  const READ_ONLY_TOOL_SELECTOR = "[data-mica-tool-safety='read-only']";
  const CONSEQUENTIAL_SELECTOR = "[data-mica-tool-safety='consequential'],[data-mica-consequential='true'],[data-testid*='write'],[data-testid*='purchase'],[data-testid*='delete'],[data-testid*='send-email']";
  const SENSITIVE_COMPOSER_SELECTOR = "[data-testid*='attachment'],[data-testid*='file'],[data-testid*='connector'],[data-testid*='tool'],[aria-label*='connector' i],[aria-label*='连接器']";
  const ACTIVE_LIFECYCLE_SELECTOR = "[role='dialog'],[data-is-streaming='true'],[data-testid*='stop' i],[aria-label*='Stop generating' i],[aria-label*='停止生成']";
  const FIXTURE_SUGGESTED_WORK_SELECTOR = "[data-mica-suggested-work-surface='true']";
  const RECOVERY_ACTION_TYPES = Object.freeze(["native_stop", "assistant_retry", "confirmed_resend"]);
  const TARGET_DIAGNOSTIC_SELECTOR = "button,[role='button'],[data-testid*='suggest' i],[data-testid*='prompt' i],[data-testid*='stop' i],[data-testid*='retry' i],[data-testid*='regenerate' i],[data-testid*='send' i]";
  const SUPPORTED_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);

  function isFixture(doc) {
    return doc?.documentElement?.dataset?.micaFixture === "true";
  }

  function hasTargetSurfaceFixtureAuthority(doc) {
    return isFixture(doc) && globalThis.__MICA_TEST_ONLY_TARGET_SURFACE_CONTRACT__ === true;
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
      const contentRoot = findContentRoot(roleNode);
      turns.push({
        turnId,
        order: turns.length,
        role,
        element,
        roleElement: roleNode,
        contentRoot,
        answerRoot: role === "assistant" ? contentRoot : null,
        variantId: isFixture(doc) ? "fixture-turn-section-role-v1" : "conversation-turn-section-role-v1"
      });
      seen.add(element);
    }
    return { turns, invalid, candidateCount: candidates.length };
  }

  function findContentRoot(roleNode) {
    if (!(roleNode instanceof HTMLElement)) return null;
    return roleNode.querySelector(":scope > .markdown, :scope > [data-message-content], :scope > .prose, :scope > .whitespace-pre-wrap") || roleNode;
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
    const actions = Array.from(turn.element.querySelectorAll(COPY_ACTION_SELECTOR))
      .filter((candidate) => candidate instanceof HTMLElement && turn.element.contains(candidate));
    if (actions.length !== 1) return null;
    const action = actions[0];
    const cluster = action.parentElement;
    if (!(cluster instanceof HTMLElement) || !turn.element.contains(cluster)) return null;
    return {
      action,
      cluster,
      variantId: "native-copy-button-parent-v1",
      insertion: "sibling-after-native-copy"
    };
  }

  function inspectAnswerActionTargets(doc = document) {
    if (!isSupportedDocument(doc)) return answerActionObservation("MISSING", "unsupported_document");
    if (!isFixture(doc)) return answerActionObservation("MISSING", "current_site_contract_unproven");
    if (!hasTargetSurfaceFixtureAuthority(doc)) return answerActionObservation("MISSING", "fixture_contract_authority_required");
    const turnInspection = inspectTurnCandidates(doc);
    if (turnInspection.invalid.length > 0) return answerActionObservation("AMBIGUOUS", "turn_contract_ambiguous");
    const targets = [];
    const turnIds = new Set();
    const clusters = new Set();
    for (const turn of turnInspection.turns) {
      if (turn.role !== "assistant" || generationStateForTurn(turn) !== "SETTLED") continue;
      const placement = findAssistantActionCluster(turn);
      if (!placement) continue;
      if (turnIds.has(turn.turnId) || clusters.has(placement.cluster)) {
        return answerActionObservation("AMBIGUOUS", "answer_action_target_not_unique");
      }
      turnIds.add(turn.turnId);
      clusters.add(placement.cluster);
      targets.push({
        turnId: turn.turnId,
        turn,
        action: placement.action,
        cluster: placement.cluster,
        variantId: placement.variantId,
        insertion: placement.insertion,
        evidenceClass: "EXACT"
      });
    }
    return answerActionObservation(targets.length > 0 ? "EXACT" : "MISSING", targets.length > 0 ? "contract_match" : "no_settled_exact_target", targets);
  }

  function answerActionObservation(evidenceClass, reason, targets = []) {
    return {
      evidenceClass,
      reason,
      targets,
      targetCount: targets.length,
      detectionSource: isFixture(targets[0]?.cluster?.ownerDocument) ? "fixture-native-copy-contract-v1" : "contract-required",
      textIncluded: false
    };
  }

  function resolveTurnFromNode(node, doc = document) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!(element instanceof Element) || !isSupportedDocument(doc)) return null;
    const matches = listTurns(doc).filter((turn) => turn.role === "assistant"
      && turn.answerRoot instanceof HTMLElement
      && turn.answerRoot.contains(element));
    return matches.length === 1 ? matches[0] : null;
  }

  function inspectAnswerContextTarget(node, doc = document) {
    const element = node instanceof Element ? node : node?.parentElement;
    if (!(element instanceof Element) || !isSupportedDocument(doc)) {
      return answerContextObservation("MISSING", "unsupported_context_target");
    }
    const inspection = inspectTurnCandidates(doc);
    if (inspection.invalid.length > 0) return answerContextObservation("AMBIGUOUS", "turn_contract_ambiguous");
    const turnIds = inspection.turns.map((turn) => turn.turnId);
    if (new Set(turnIds).size !== turnIds.length) return answerContextObservation("AMBIGUOUS", "turn_identity_ambiguous");
    const matches = inspection.turns.filter((turn) => turn.role === "assistant"
      && turn.answerRoot instanceof HTMLElement
      && turn.answerRoot.contains(element));
    if (matches.length !== 1) {
      return answerContextObservation(matches.length > 1 ? "AMBIGUOUS" : "MISSING", matches.length > 1 ? "answer_context_not_unique" : "not_an_assistant_answer");
    }
    const turn = matches[0];
    if (generationStateForTurn(turn) !== "SETTLED") return answerContextObservation("MISSING", "answer_not_settled");
    return answerContextObservation("EXACT", "trusted_context_target", turn);
  }

  function answerContextObservation(evidenceClass, reason, turn = null) {
    return {
      evidenceClass,
      reason,
      turnId: turn?.turnId || null,
      turn,
      variantId: turn ? `${turn.variantId}:answer-context-v1` : "unproven-v1",
      textIncluded: false
    };
  }

  function generationStateForTurn(turn) {
    if (!turn || turn.role !== "assistant" || !(turn.element instanceof HTMLElement)) return null;
    if (isFixture(turn.element.ownerDocument)) {
      const state = turn.element.dataset.micaGenerationState;
      return state === "STREAMING" || state === "SETTLED" ? state : null;
    }
    const doc = turn.element.ownerDocument;
    const streaming = doc.querySelector("[data-is-streaming='true'],[aria-busy='true'][data-message-author-role='assistant'],[data-testid*='stop' i],[aria-label*='Stop generating' i],[aria-label*='停止生成']");
    if (streaming) return "STREAMING";
    return turn.answerRoot instanceof HTMLElement && normalizeVisibleText(turn.answerRoot.textContent || "") ? "SETTLED" : null;
  }

  function inspectComposerRecovery(doc = document) {
    const composer = findComposer(doc);
    if (!composer?.element) {
      return { composer: null, form: null, value: "", sensitiveContext: true, consequentialAction: false, toolSafety: "unknown", evidenceClass: "MISSING", reason: "composer_unavailable" };
    }
    const form = composer.element.closest("form");
    const scope = form || composer.element.parentElement || composer.element;
    const consequentialAction = !!scope.querySelector?.(CONSEQUENTIAL_SELECTOR);
    const sensitiveContext = consequentialAction || !!scope.querySelector?.(SENSITIVE_COMPOSER_SELECTOR);
    return {
      composer,
      form,
      value: composerValue(composer.element),
      sensitiveContext,
      consequentialAction,
      toolSafety: consequentialAction ? "consequential" : sensitiveContext ? "unknown" : "none",
      evidenceClass: isFixture(doc) ? "EXACT" : "PARTIAL",
      reason: null
    };
  }

  function inspectTurnRecovery(turn) {
    if (!turn || turn.role !== "assistant" || !(turn.element instanceof HTMLElement) || !(turn.answerRoot instanceof HTMLElement)) {
      return { progressSignature: null, generationState: null, toolSafety: "unknown", toolStageCount: 0, evidenceClass: "MISSING", reason: "assistant_turn_unavailable" };
    }
    const text = normalizeVisibleText(turn.answerRoot.textContent || "");
    const toolStageCount = turn.element.querySelectorAll(TOOL_STAGE_SELECTOR).length;
    const consequential = !!turn.element.querySelector(CONSEQUENTIAL_SELECTOR);
    const readOnly = !!turn.element.querySelector(READ_ONLY_TOOL_SELECTOR);
    const toolSafety = consequential ? "consequential" : readOnly ? "read_only" : toolStageCount ? "unknown" : "none";
    return {
      progressSignature: text || toolStageCount ? `${fingerprint(text)}:stages=${toolStageCount}` : null,
      generationState: generationStateForTurn(turn),
      toolSafety,
      toolStageCount,
      evidenceClass: isFixture(turn.element.ownerDocument) ? "EXACT" : "PARTIAL",
      reason: null
    };
  }

  function inspectReloadSafety(doc = document) {
    if (!isSupportedDocument(doc)) return { safe: false, reason: "unsupported_document", evidenceClass: "MISSING" };
    const composerContext = inspectComposerRecovery(doc);
    if (!composerContext.composer) return { safe: false, reason: composerContext.reason, evidenceClass: composerContext.evidenceClass };
    if (composerContext.value.trim()) return { safe: false, reason: "composer_not_empty", evidenceClass: composerContext.evidenceClass };
    if (doc.querySelector(ACTIVE_LIFECYCLE_SELECTOR)) return { safe: false, reason: "active_dialog_or_stream", evidenceClass: isFixture(doc) ? "EXACT" : "PARTIAL" };
    return { safe: true, reason: "empty_composer_no_active_lifecycle_marker", evidenceClass: isFixture(doc) ? "EXACT" : "PARTIAL" };
  }

  function inspectSuggestedWorkSurface(doc = document) {
    if (!isSupportedDocument(doc)) return suggestedWorkObservation("MISSING", "unsupported_document");
    if (!hasTargetSurfaceFixtureAuthority(doc)) {
      return suggestedWorkObservation("MISSING", "current_site_contract_unproven", {
        detectionSource: "contract-required"
      });
    }
    const composer = findComposer(doc)?.element;
    if (!(composer instanceof HTMLElement)) return suggestedWorkObservation("MISSING", "composer_unavailable");
    const candidates = Array.from(doc.querySelectorAll(FIXTURE_SUGGESTED_WORK_SELECTOR))
      .filter((candidate) => validFixtureSuggestedWorkSurface(candidate, composer));
    if (candidates.length !== 1) {
      return suggestedWorkObservation(candidates.length > 1 ? "AMBIGUOUS" : "MISSING", candidates.length > 1 ? "multiple_contract_candidates" : "contract_candidate_unavailable", {
        candidateCount: candidates.length,
        detectionSource: "fixture-contract-v1"
      });
    }
    return suggestedWorkObservation("EXACT", "contract_match", {
      surface: candidates[0],
      candidateCount: 1,
      detectionSource: "fixture-contract-v1",
      variantId: "composer-sibling-suggested-work-v1"
    });
  }

  function validFixtureSuggestedWorkSurface(candidate, composer) {
    if (!(candidate instanceof HTMLElement) || candidate === composer || candidate.contains(composer) || composer.contains(candidate)) return false;
    if (candidate.getAttribute("data-mica-suggested-work-variant") !== "composer-sibling-v1") return false;
    if (!boundedCommonAncestor(candidate, composer, 4)) return false;
    if (candidate.closest("form") || candidate.querySelector("input,textarea,select,[contenteditable='true'],[role='textbox'],[role='dialog'],[role='menu'],[role='listbox']")) return false;
    const actions = candidate.querySelectorAll("button,[role='button']");
    return actions.length > 0 && actions.length <= 12;
  }

  function suggestedWorkObservation(evidenceClass, reason, extra = {}) {
    return {
      surface: null,
      evidenceClass,
      reason,
      candidateCount: 0,
      detectionSource: "none",
      variantId: "unproven-v1",
      ...extra
    };
  }

  function inspectRecoveryControl(actionType, state, doc = document) {
    if (!RECOVERY_ACTION_TYPES.includes(actionType)) return recoveryControlObservation(actionType, "MISSING", "unsupported_action_type");
    if (!isSupportedDocument(doc)) return recoveryControlObservation(actionType, "MISSING", "unsupported_document");
    if (!hasTargetSurfaceFixtureAuthority(doc)) return recoveryControlObservation(actionType, "MISSING", "current_site_contract_unproven");
    const subject = actionType === "confirmed_resend" ? state?.promptFingerprint : state?.assistantTurnId;
    if (!subject) return recoveryControlObservation(actionType, "MISSING", "recovery_subject_unavailable");
    const candidates = Array.from(doc.querySelectorAll(`[data-mica-recovery-control='${actionType}']`))
      .filter((candidate) => validFixtureRecoveryControl(candidate, actionType, subject));
    if (candidates.length !== 1) {
      return recoveryControlObservation(actionType, candidates.length > 1 ? "AMBIGUOUS" : "MISSING", candidates.length > 1 ? "multiple_contract_candidates" : "contract_candidate_unavailable", {
        candidateCount: candidates.length
      });
    }
    const control = candidates[0];
    const controlIdentity = `${actionType}|${subject}|${control.getAttribute("data-mica-recovery-control-id")}`;
    return recoveryControlObservation(actionType, "EXACT", "contract_match", {
      control,
      controlIdHash: hashIdentity(controlIdentity),
      subjectHash: hashIdentity(subject),
      candidateCount: 1,
      variantId: `fixture-${actionType}-control-v1`
    });
  }

  function validFixtureRecoveryControl(candidate, actionType, subject) {
    if (!(candidate instanceof HTMLElement) || String(candidate.tagName || "").toUpperCase() !== "BUTTON") return false;
    if (candidate.disabled === true || candidate.hidden === true || candidate.getAttribute("aria-disabled") === "true") return false;
    if (candidate.getAttribute("data-mica-recovery-control") !== actionType) return false;
    if (candidate.getAttribute("data-mica-recovery-subject") !== subject) return false;
    return /^[a-z0-9._:-]{1,96}$/i.test(candidate.getAttribute("data-mica-recovery-control-id") || "");
  }

  function recoveryControlObservation(actionType, evidenceClass, reason, extra = {}) {
    return {
      actionType,
      control: null,
      controlIdHash: null,
      subjectHash: null,
      candidateCount: 0,
      evidenceClass,
      reason,
      variantId: "unproven-v1",
      ...extra
    };
  }

  function executeRecoveryControl(action, state, doc = document) {
    if (!action || !RECOVERY_ACTION_TYPES.includes(action.type)) return { ok: false, reason: "invalid_recovery_action" };
    const observation = inspectRecoveryControl(action.type, state, doc);
    if (observation.evidenceClass !== "EXACT" || !observation.control) return { ok: false, reason: observation.reason || "recovery_control_unavailable" };
    if (observation.controlIdHash !== action.controlIdHash) return { ok: false, reason: "recovery_control_identity_changed" };
    if (action.type === "confirmed_resend") {
      const composerContext = inspectComposerRecovery(doc);
      if (composerContext.evidenceClass !== "EXACT" || !composerContext.composer?.element) return { ok: false, reason: "composer_contract_unavailable" };
      if (composerContext.value.trim()) return { ok: false, reason: "composer_not_empty" };
      if (!String(action.draft || "").trim()) return { ok: false, reason: "resend_draft_unavailable" };
      setComposerValue(composerContext.composer.element, String(action.draft));
    }
    observation.control.click();
    return { ok: true, reason: "exact_native_control_invoked", controlIdHash: observation.controlIdHash };
  }

  function inspectTargetSurfaceDiagnostics(doc = document) {
    if (!isSupportedDocument(doc)) return targetSurfaceDiagnostics("unsupported_document");
    const composer = findComposer(doc);
    const turns = listTurns(doc);
    const lastAssistant = turns.filter((turn) => turn.role === "assistant").at(-1) || null;
    const roots = [];
    if (composer?.element) {
      const form = composer.element.closest("form");
      let current = form?.parentElement || composer.element.parentElement;
      for (let depth = 1; current instanceof HTMLElement && depth <= 3; depth += 1) {
        roots.push({ root: current, relation: `composer-ancestor-${depth}` });
        current = current.parentElement;
      }
    }
    if (lastAssistant?.element instanceof HTMLElement) roots.push({ root: lastAssistant.element, relation: "latest-assistant-turn" });
    const candidates = [];
    const seen = new Set();
    for (const entry of roots) {
      for (const node of Array.from(entry.root.querySelectorAll(TARGET_DIAGNOSTIC_SELECTOR))) {
        if (!(node instanceof HTMLElement) || seen.has(node) || candidates.length >= 32) continue;
        seen.add(node);
        candidates.push(sanitizeTargetCandidate(node, entry.relation));
      }
    }
    const suggestedWork = inspectSuggestedWorkSurface(doc);
    return targetSurfaceDiagnostics("captured", {
      composerPresent: !!composer,
      composerVariantId: composer?.variantId || null,
      latestAssistantPresent: !!lastAssistant,
      boundedRootCount: roots.length,
      candidateCount: candidates.length,
      candidates,
      suggestedWorkContract: {
        evidenceClass: suggestedWork.evidenceClass,
        reason: suggestedWork.reason,
        candidateCount: suggestedWork.candidateCount,
        detectionSource: suggestedWork.detectionSource,
        variantId: suggestedWork.variantId
      },
      recoveryControlContract: Object.fromEntries(RECOVERY_ACTION_TYPES.map((actionType) => {
        const observation = inspectRecoveryControl(actionType, {
          assistantTurnId: lastAssistant?.turnId || null,
          promptFingerprint: "diagnostic-only"
        }, doc);
        return [actionType, {
          evidenceClass: observation.evidenceClass,
          reason: observation.reason,
          candidateCount: observation.candidateCount,
          variantId: observation.variantId
        }];
      }))
    });
  }

  function sanitizeTargetCandidate(node, relation) {
    const ariaLabel = node.getAttribute("aria-label") || "";
    const testId = node.getAttribute("data-testid") || "";
    const dataType = node.getAttribute("data-type") || "";
    return {
      relation,
      tag: String(node.tagName || "").toLowerCase().slice(0, 24),
      role: structuralToken(node.getAttribute("role")),
      testId: structuralToken(testId),
      dataType: structuralToken(dataType),
      ariaSemantic: classifyAriaSemantic(ariaLabel),
      ariaLabelFingerprint: ariaLabel ? fingerprint(ariaLabel) : null,
      disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
      hidden: node.hidden === true || node.getAttribute("aria-hidden") === "true"
    };
  }

  function targetSurfaceDiagnostics(reason, extra = {}) {
    return {
      schemaVersion: 1,
      reason,
      composerPresent: false,
      composerVariantId: null,
      latestAssistantPresent: false,
      boundedRootCount: 0,
      candidateCount: 0,
      candidates: [],
      suggestionTextIncluded: false,
      conversationTextIncluded: false,
      rawDomIncluded: false,
      ...extra
    };
  }

  function structuralToken(value) {
    const token = String(value || "").trim();
    return /^[a-z0-9._:-]{1,96}$/i.test(token) && !/^conversation-turn-/i.test(token) ? token : null;
  }

  function classifyAriaSemantic(value) {
    const normalized = normalizeVisibleText(value).toLowerCase();
    if (!normalized) return "none";
    if (/stop(?: generating)?|停止生成/.test(normalized)) return "stop";
    if (/retry|regenerate|重试|重新生成/.test(normalized)) return "retry";
    if (/send(?: message| prompt)?|发送/.test(normalized)) return "send";
    if (/suggest|prompt starter|建议|推荐/.test(normalized)) return "suggested";
    return "other";
  }

  function boundedCommonAncestor(first, second, maxDepth) {
    const ancestors = new Set();
    let current = first?.parentElement;
    for (let depth = 0; current instanceof HTMLElement && depth < maxDepth; depth += 1) {
      ancestors.add(current);
      current = current.parentElement;
    }
    current = second?.parentElement;
    for (let depth = 0; current instanceof HTMLElement && depth < maxDepth; depth += 1) {
      if (ancestors.has(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function setComposerValue(composer, value) {
    if (composer instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(composer, value);
    else if (composer instanceof HTMLInputElement) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer, value);
    else composer.textContent = value;
    const EventConstructor = typeof InputEvent === "function" ? InputEvent : Event;
    composer.dispatchEvent(new EventConstructor("input", { bubbles: true, inputType: "insertText", data: null }));
  }

  function composerValue(composer) {
    return composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement ? composer.value : composer?.textContent || "";
  }

  function normalizeVisibleText(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function fingerprint(value) {
    const normalized = normalizeVisibleText(value);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
  }

  function hashIdentity(value) {
    const text = String(value || "");
    return `${hashText(text)}${hashText(`mica:${text}`)}`;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
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
      capability("lifecycle.streamingEditBranchTools", "unproven-v1", "UNKNOWN", [], "Current lifecycle contract is not yet proven."),
      capability("recovery.nativeControls", "unproven-v1", "UNKNOWN", [], "Current native Stop, retry and resend control identities are not yet proven."),
      capability("interface.suggestedWork", "unproven-v1", "UNKNOWN", [], "Current suggested-work surface identity is not yet proven.")
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
    resolveTurnFromNode,
    inspectAnswerContextTarget,
    findComposer,
    findAssistantActionCluster,
    inspectAnswerActionTargets,
    generationStateForTurn,
    inspectComposerRecovery,
    inspectTurnRecovery,
    inspectReloadSafety,
    inspectSuggestedWorkSurface,
    inspectRecoveryControl,
    executeRecoveryControl,
    inspectTargetSurfaceDiagnostics
  });
})();
