import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_LABEL, DEV_DIST_DIR_NAME, ICON_SIZES, MACHINE_VERSION, REQUIRED_EXTENSION_FILES, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const convergenceMatrix = JSON.parse(await readFile(path.join(root, "docs", "product", "MICA_FUNCTIONAL_CONVERGENCE_V1.json"), "utf8"));

assert(packageMetadata.version === MACHINE_VERSION, "package version must match release config");
assert(convergenceMatrix.candidate?.version === MACHINE_VERSION, "convergence matrix version must match release config");
assert(convergenceMatrix.candidate?.buildLabel === BUILD_LABEL, "convergence matrix build label must match release config");
const requirementIds = new Set();
for (const requirement of convergenceMatrix.requirements || []) {
  assert(/^MFC-\d{3}$/.test(requirement.id), "convergence requirement id is invalid");
  assert(!requirementIds.has(requirement.id), `duplicate convergence requirement: ${requirement.id}`);
  requirementIds.add(requirement.id);
  assert(convergenceMatrix.statusVocabulary.includes(requirement.status), `unknown convergence status: ${requirement.status}`);
  for (const field of ["source", "userProblem", "module", "iterationAction", "successBehavior", "automatedVerification", "realAcceptance", "result", "gap"]) {
    assert(field in requirement, `convergence requirement ${requirement.id} missing ${field}`);
  }
}
assert(requirementIds.size >= 20, "convergence matrix does not cover the minimum functional groups");

for (const relative of REQUIRED_EXTENSION_FILES) await assertFile(path.join(distDir, relative));

const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === MACHINE_VERSION, "manifest version must match release config");
assert(manifest.version_name === VERSION_NAME, "manifest version_name must match release config");
assert(manifest.action?.default_popup === "popup/index.html", "action.default_popup missing");
assert(manifest.action?.default_title === "Mica", "action.default_title missing");
assert(manifest.permissions?.includes("storage"), "storage permission missing");
assert(manifest.permissions?.includes("activeTab"), "activeTab permission missing");
assert(manifest.permissions?.includes("scripting"), "scripting permission missing");
assert(manifest.permissions?.includes("clipboardWrite"), "clipboardWrite permission missing");
assert(!manifest.host_permissions?.some((host) => !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(host)), "unexpected host permission");
assert(JSON.stringify([...manifest.host_permissions].sort()) === JSON.stringify(["https://chat.openai.com/*", "https://chatgpt.com/*"]), "fixed ChatGPT host permissions drifted");
assert(JSON.stringify([...manifest.optional_host_permissions].sort()) === JSON.stringify(["http://*/*", "https://*/*"]), "optional general-web host permissions missing");
assert(manifest.background?.service_worker === "low-memory-background.js", "Low Memory registration service worker missing");
assert(manifest.options_ui?.page === "options/index.html" && manifest.options_ui?.open_in_tab === true, "settings page registration missing");
assert(JSON.stringify(manifest.content_scripts?.[0]?.js) === JSON.stringify(["low-memory-config.js"]) && manifest.content_scripts?.[0]?.run_at === "document_start", "Low Memory config bridge order drifted");
assert(JSON.stringify(manifest.content_scripts?.[1]?.js) === JSON.stringify(["settings-model.js", "chatgpt-adapter.js", "answer-document.js", "conversation-export.js", "answer-serializer.js", "highlight-engine.js", "pdf-export-model.js", "recovery-action-policy.js", "recovery-state-machine.js", "recovery-controller.js", "content.js"]), "functional convergence content-script order drifted");
assert(!manifest.content_scripts.some((entry) => entry.world === "MAIN"), "Low Memory MAIN scripts must be extension-controlled dynamic registrations");

for (const size of [16, 32, 48, 128]) {
  assert(manifest.icons?.[size] === `icons/icon${size}.png`, `manifest icon${size} missing`);
  assert(manifest.action?.default_icon?.[size] === `icons/icon${size}.png`, `action.default_icon icon${size} missing`);
}
for (const size of ICON_SIZES) {
  const dimensions = await pngDimensions(path.join(distDir, "icons", `icon${size}.png`));
  assert(dimensions.width === size && dimensions.height === size, `icon${size}.png has wrong dimensions`);
}

const contractSource = await readFile(path.join(root, "contracts", "chatgpt", "current.json"));
const contractHash = createHash("sha256").update(contractSource).digest("hex");
const adapter = await readFile(path.join(distDir, "chatgpt-adapter.js"), "utf8");
const answerDocument = await readFile(path.join(distDir, "answer-document.js"), "utf8");
const conversationExport = await readFile(path.join(distDir, "conversation-export.js"), "utf8");
const settingsModel = await readFile(path.join(distDir, "settings-model.js"), "utf8");
const answerSerializer = await readFile(path.join(distDir, "answer-serializer.js"), "utf8");
const highlightEngine = await readFile(path.join(distDir, "highlight-engine.js"), "utf8");
const generalWebModel = await readFile(path.join(distDir, "general-web-model.js"), "utf8");
const generalWebHighlighter = await readFile(path.join(distDir, "general-web-highlighter.js"), "utf8");
const pdfExportModel = await readFile(path.join(distDir, "pdf-export-model.js"), "utf8");
const recoveryActionPolicy = await readFile(path.join(distDir, "recovery-action-policy.js"), "utf8");
const recoveryStateMachine = await readFile(path.join(distDir, "recovery-state-machine.js"), "utf8");
const recoveryController = await readFile(path.join(distDir, "recovery-controller.js"), "utf8");
const recoveryLedger = await readFile(path.join(distDir, "recovery-ledger.js"), "utf8");
const content = await readFile(path.join(distDir, "content.js"), "utf8");
const lowMemoryCore = await readFile(path.join(distDir, "low-memory-core.js"), "utf8");
const lowMemoryPage = await readFile(path.join(distDir, "low-memory-page.js"), "utf8");
const lowMemoryConfig = await readFile(path.join(distDir, "low-memory-config.js"), "utf8");
const lowMemoryBackground = await readFile(path.join(distDir, "low-memory-background.js"), "utf8");
const popup = await readFile(path.join(distDir, "popup", "popup.js"), "utf8");
const options = await readFile(path.join(distDir, "options", "options.js"), "utf8");
const troubleshooting = await readFile(path.join(distDir, "popup", "troubleshooting.js"), "utf8");
const qa = await readFile(path.join(distDir, "popup", "qa.js"), "utf8");
const pdfExportPage = await readFile(path.join(distDir, "pdf", "pdf-export-page.js"), "utf8");

for (const text of [adapter, content]) assert(text.includes(contractHash), "built current ChatGPT contract hash drifted");
for (const text of [adapter, answerDocument, conversationExport, settingsModel, answerSerializer, highlightEngine, generalWebModel, generalWebHighlighter, pdfExportModel, recoveryActionPolicy, recoveryStateMachine, recoveryController, recoveryLedger, lowMemoryCore, lowMemoryPage, lowMemoryConfig, lowMemoryBackground, content, popup, options, troubleshooting, qa, pdfExportPage]) {
  assert(!/__MICA_(?:VERSION|VERSION_NAME|BUILD_LABEL|CHATGPT_CONTRACT_HASH|DEV_BUILD)__/.test(text), "unresolved build placeholder remains");
  new Function(text);
}

for (const token of [
  "MicaChatGPTAdapter",
  "conversation-turn-section-role-v1",
  "native-copy-button-parent-v1",
  "prompt-textarea-contenteditable-v1",
  "failOpen"
]) assert(adapter.includes(token), `adapter missing ${token}`);

for (const token of [
  "MicaAnswerDocument",
  "orderedBlocks",
  "sourceVersion",
  "STREAMING",
  "SETTLED",
  "opaque_interactive",
  "unknown_block",
  "inline_math",
  "display_math"
]) assert(answerDocument.includes(token), `AnswerDocument core missing ${token}`);
for (const token of ["MicaSettingsModel", "noProgressTimeoutSeconds", "maxAutoReloadsPerTurn", "consequentialActionAutoReplay", "micaSettings"]) assert(settingsModel.includes(token), `settings model missing ${token}`);
for (const token of ["MicaConversationExport", "validateBundle", "completeSelection", "roleSequenceHash", "turnSequenceHash", "conversation_completeness_unproven", "assistant_not_settled"]) assert(conversationExport.includes(token), `conversation export coordinator missing ${token}`);
for (const token of ["generalWebOrigins", "normalizeWebOrigin", "toMatchPattern", "chatgpt.com"]) assert(settingsModel.includes(token), `settings origin model missing ${token}`);
for (const token of ["MicaAnswerSerializer", "serializeMarkdown", "serializeNotion", "serializeNotionImport", "conversation_completeness_unproven", "notion_native_equations_require_real_target_validation"]) assert(answerSerializer.includes(token), `answer serializer missing ${token}`);
for (const token of ["MicaRecoveryActionPolicy", "EXACT", "native_stop", "assistant_retry", "confirmed_resend", "action_evidence_expired", "action_identity_mismatch", "consequential_or_unknown_action"]) assert(recoveryActionPolicy.includes(token), `recovery action policy missing ${token}`);
for (const token of ["MicaRecoveryStateMachine", "A_COMMITTED", "B_NOT_COMMITTED", "C_UNKNOWN", "reload_limit_reached", "consequential_or_unknown_action", "ACTION_EVIDENCE", "NATIVE_STOP_SETTLING", "actionClaim", "recovery_backend_unavailable", "rawConversationIdIncluded: false"]) assert(recoveryStateMachine.includes(token), `recovery state machine missing ${token}`);
for (const token of ["MicaRecoveryController", "MICA_RELIABILITY_CONTEXT", "MICA_RELIABILITY_CLAIM_ACTION", "MICA_RELIABILITY_APPEND_HISTORY", "chrome.storage.session", "trusted_submit", "submitActionEvidence", "executeRecoveryAction", "draftIncluded: false"]) assert(recoveryController.includes(token), `recovery controller missing ${token}`);
for (const token of ["MicaRecoveryLedger", "micaRecoveryActionClaimsV1", "native_stop", "confirmed_resend", "already_claimed", "claim_identity_conflict", "history_duplicate", "rawConversationIdIncluded: false"]) assert(recoveryLedger.includes(token), `recovery ledger missing ${token}`);

for (const token of [
  "MicaHighlightEngine",
  "micaHighlightsV1",
  "anchor_unresolved",
  "conversationId",
  "sourceVersion",
  "textQuote",
  "mathTeX",
  "exportJson",
  "importJson",
  "mergeRecords",
  "recordsForScope"
]) assert(highlightEngine.includes(token), `HighlightEngine missing ${token}`);
for (const token of ["MicaGeneralWebHighlightModel", "micaGeneralWebHighlightsV1", "quote_ambiguous", "root_mismatch", "recordsForPage", "mergeRecords"]) assert(generalWebModel.includes(token), `general web model missing ${token}`);
for (const token of ["CSS.highlights", "new Highlight", "handleShortcutKeydown", "requestAnimationFrame", "MutationObserver", "requestIdleCallback", "Clear page", "generalWebOrigins", "indexRoot"]) assert(generalWebHighlighter.includes(token), `general web runtime missing ${token}`);

for (const token of ["captureHighlightSelection", "resolveHighlightAnchor", "unique_quote_context", "extractRawMathSources"]) {
  assert(answerDocument.includes(token), `AnswerDocument highlight mapping missing ${token}`);
}

for (const token of ["resolveTurnFromNode", "STREAMING", "SETTLED"]) {
  assert(adapter.includes(token), `adapter highlight capability missing ${token}`);
}

for (const token of [
  "MICA_GET_STATUS",
  "MICA_SET_SETTINGS",
  "MICA_QA_EXPORT",
  "MICA_GET_ANSWER_DOCUMENT",
  "MICA_SERIALIZE_CONVERSATION",
  "MICA_EXPORT_CONVERSATION_PDF",
  "MICA_LOAD_FULL_HISTORY",
  "mica-developer-qa.v1",
  `const VERSION = "${MACHINE_VERSION}"`,
  `const BUILD_LABEL = "${BUILD_LABEL}"`,
  "conversationTextIncluded: false",
  "rawDomIncluded: false"
]) assert(content.includes(token), `content runtime missing ${token}`);
for (const token of ["collectConversationBundle", "conversationExportStatus", "completenessProof", "MicaConversationExport"]) assert(content.includes(token), `conversation export runtime missing ${token}`);
for (const token of ["data-mica-ui", "highlight-toolbar", "Copy Markdown", "Copy for Notion", "event.isTrusted", "CSS.highlights", "permanentToolbar: false"]) {
  assert(content.includes(token), `Highlighter runtime missing ${token}`);
}
for (const token of ["MicaPdfExport", "buildConversationModel", "unsupported_answer_structure", "visible-tex-source", "localOnly: true"]) assert(pdfExportModel.includes(token), `PDF export model missing ${token}`);
for (const token of ["MICA_OPEN_PDF_EXPORT", "MICA_GET_PDF_EXPORT", "MAX_PDF_EXPORT_BYTES", "chrome.tabs.create"]) assert(lowMemoryBackground.includes(token), `PDF background flow missing ${token}`);
for (const token of ["Print / Save as PDF", "MicaPdfExportPage", "dataset.micaPdfKind", "window.print"]) assert(`${await readFile(path.join(distDir, "pdf", "pdf-export.html"), "utf8")}\n${pdfExportPage}`.includes(token), `PDF export page missing ${token}`);

for (const token of ["windowTurboStreamChunk", "windowJsonPayload", "client-history-window", "reactManagedInteractiveNodesDetached", "visibleRoleSequenceHash"]) {
  assert(lowMemoryCore.includes(token), `Low Memory core missing ${token}`);
}
for (const token of ["__reactRouterContext", "streamController", "conversation-json", "serverMutation: false", "completenessProof", "validated-conversation-graph"]) {
  assert(lowMemoryPage.includes(token), `Low Memory page interceptor missing ${token}`);
}
for (const token of ["MICA_LOW_MEMORY_SYNC", "MICA_LOW_MEMORY_GET_TAB_MODE", "MICA_LOW_MEMORY_PREPARE_FULL_HISTORY", "MICA_LOW_MEMORY_RESUME_WINDOWING"]) {
  assert(lowMemoryConfig.includes(token), `Low Memory config bridge missing ${token}`);
}
for (const token of ["event.isTrusted", "trusted_action_required", "page_untrusted", "extension_ui_or_trusted_user_gesture"]) {
  assert(content.includes(token), `Low Memory recovery trust boundary missing ${token}`);
}
for (const token of ["chrome.scripting.registerContentScripts", "world: \"MAIN\"", "persistAcrossSessions: true", "full_history_bypass", "mica.lowMemory.completeness.v1", "validated-conversation-graph"]) {
  assert(lowMemoryBackground.includes(token), `Low Memory background controller missing ${token}`);
}
for (const token of ["MICA_RELIABILITY_CLAIM_ACTION", "MICA_RELIABILITY_APPEND_HISTORY", "claimRecoveryAction", "appendRecoveryHistory", "clearTabClaims"]) {
  assert(lowMemoryBackground.includes(token), `recovery background ledger integration missing ${token}`);
}
for (const token of ["MicaGeneralWebBackground", "mica-general-web-highlighter-v1", "MICA_GENERAL_WEB_SYNC", "world: \"ISOLATED\"", "chrome.permissions", "onRemoved", "general-web-highlighter.js"]) {
  assert(lowMemoryBackground.includes(token), `general web background controller missing ${token}`);
}

const reportBody = extractFunctionBody(content, "buildSanitizedQaReport");
assert(!/innerText|textContent|innerHTML|outerHTML/.test(reportBody), "sanitized QA report must not read conversation text/HTML");
for (const text of [settingsModel, conversationExport, answerSerializer, highlightEngine, pdfExportModel, recoveryActionPolicy, recoveryStateMachine, recoveryController, recoveryLedger, lowMemoryCore, lowMemoryPage, lowMemoryConfig, lowMemoryBackground]) {
  assert(!/addEventListener\(["'](?:beforeinput|input|keydown|compositionstart|compositionupdate|compositionend)/.test(text), "runtime added a typing hot-path listener");
}
assert(!/addEventListener\(["'](?:beforeinput|input|compositionstart|compositionupdate|compositionend)/.test(generalWebHighlighter), "general web runtime added a synchronous typing listener");
const generalWebKeydownBody = extractFunctionBody(generalWebHighlighter, "handleShortcutKeydown");
for (const token of ["querySelector", "querySelectorAll", "createTreeWalker", "cloneNode", "getComputedStyle", "getBoundingClientRect", "textContent", "innerText", "chrome.storage", "setTimeout", "indexRoot"]) {
  assert(!generalWebKeydownBody.includes(token), `general web shortcut hot path includes heavy work: ${token}`);
}
for (const token of ["isEditableTarget", "requestAnimationFrame", "event.key.toLowerCase()"] ) assert(generalWebKeydownBody.includes(token), `general web shortcut hot path missing guard: ${token}`);
assert(!/addEventListener\(["'](?:beforeinput|input|compositionstart|compositionupdate|compositionend)/.test(content), "content runtime added a typing hot-path listener");
assert(!/(?:document|globalThis|window)\.addEventListener\(["']keydown/.test(content), "content runtime added a global keydown hot-path listener");
const highlightKeyUpBody = extractFunctionBody(content, "handleHighlightKeyUp");
for (const token of ["querySelector", "querySelectorAll", "cloneNode", "getComputedStyle", "getBoundingClientRect", "textContent", "innerText", "chrome.storage", "setTimeout", "listTurns"]) {
  assert(!highlightKeyUpBody.includes(token), `Highlighter keyboard hot path includes heavy work: ${token}`);
}
for (const token of ["!event.shiftKey", "isEditableTarget", "requestAnimationFrame"]) {
  assert(highlightKeyUpBody.includes(token), `Highlighter keyboard hot path missing guard: ${token}`);
}
assert(!/Range\.prototype|Selection\.prototype/.test(`${answerDocument}\n${highlightEngine}\n${content}`), "Highlighter must not patch global Range/Selection prototypes");

const normalHtml = await readFile(path.join(distDir, "popup", "index.html"), "utf8");
for (const token of ["Mica", "Enable Mica", "Checking this page…", "Low memory", "Keeps 40 recent turns active", "Load full history", "Complete conversation", "Copy Markdown", "Export PDF", "Page health", "Settings", "Troubleshooting", "Advanced"]) {
  assert(normalHtml.includes(token), `normal popup missing ${token}`);
}

const optionsHtml = await readFile(path.join(distDir, "options", "index.html"), "utf8");
for (const token of ["General", "Reading & highlighting", "Allow one website", "Add site", "Copy & export", "Performance", "Reliability", "Allow native Stop when verified", "Maximum recovery cycles per turn", "Maximum confirmed-unsent resends", "Maximum assistant retries", "Recover read-only tools", "Hide suggested work", "Export highlights", "Import highlights", "Clear all highlights", "Export settings", "Restore all defaults", "Save settings"]) {
  assert(optionsHtml.includes(token), `settings page missing ${token}`);
}
assert(optionsHtml.indexOf("../settings-model.js") < optionsHtml.indexOf("../highlight-engine.js") && optionsHtml.indexOf("../highlight-engine.js") < optionsHtml.indexOf("../general-web-model.js") && optionsHtml.indexOf("../general-web-model.js") < optionsHtml.indexOf("options.js"), "settings dependency script order drifted");
for (const token of ["MicaSettingsModel", "MicaHighlightEngine", "MicaGeneralWebHighlightModel", "autoStopEnabled", "maxRecoveryCyclesPerTurn", "maxAutoNewMessageResends", "maxAutoAssistantRetries", "consequentialActionAutoReplay: false", "micaRecoveryHistoryV1", "chrome.permissions.request", "MICA_GENERAL_WEB_SYNC", "generalWebRecords", "mergeRecords", "mica-highlights.json"]) assert(options.includes(token), `settings runtime missing ${token}`);
for (const forbidden of ["Start diagnostics", "Stop diagnostics", "Copy report", "mounted", "selector", "Surface Atlas"]) {
  assert(!normalHtml.includes(forbidden), `normal popup exposes internal diagnostic copy: ${forbidden}`);
}

const troubleshootingHtml = await readFile(path.join(distDir, "popup", "troubleshooting.html"), "utf8");
for (const token of ["Troubleshooting", "Run self-check", "Export diagnostic bundle", "not conversation text", "Open Developer QA"]) {
  assert(troubleshootingHtml.includes(token), `troubleshooting surface missing ${token}`);
}
const qaHtml = await readFile(path.join(distDir, "popup", "qa.html"), "utf8");
for (const token of ["Developer QA", "Development build", "Refresh compatibility", "Run focused checks", "Export sanitized evidence"]) {
  assert(qaHtml.includes(token), `Developer QA surface missing ${token}`);
}

for (const legacy of [
  "known-interruptions.js",
  "connector-lifecycle-signal.js",
  "composer-diagnostics.js",
  "stale-composer-recovery.js",
  "connector-continuity.js",
  "send-residual-recovery.js"
]) {
  assert(!manifest.content_scripts.some((entry) => entry.js.includes(legacy)), `legacy runtime entrypoint remains active: ${legacy}`);
  await assertMissing(path.join(distDir, legacy));
}

console.log("Build validation passed");

async function assertFile(file) {
  const info = await stat(file);
  assert(info.isFile(), `${file} is not a file`);
}

async function assertMissing(file) {
  try {
    await stat(file);
    throw new Error(`${file} should not exist`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function pngDimensions(file) {
  const buffer = await readFile(file);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
