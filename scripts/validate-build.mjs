import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_DIST_DIR_NAME, ICON_SIZES, MACHINE_VERSION, REQUIRED_EXTENSION_FILES, VERSION_NAME } from "./release-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist", DEV_DIST_DIR_NAME);

for (const relative of REQUIRED_EXTENSION_FILES) {
  await assertFile(path.join(distDir, relative));
}

const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === MACHINE_VERSION, "manifest version must match release config");
assert(manifest.version_name === VERSION_NAME, "manifest version_name must match release config");
assert(manifest.action?.default_popup === "popup/index.html", "action.default_popup missing");
assert(manifest.action?.default_title === "Mica", "action.default_title missing");
assert(manifest.permissions?.includes("storage"), "storage permission missing");
assert(manifest.permissions?.includes("activeTab"), "activeTab permission missing");
assert(!manifest.host_permissions?.some((host) => !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(host)), "unexpected host permission");
assert(manifest.content_scripts?.[0]?.js?.[0] === "known-interruptions.js", "known interruptions script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[1] === "connector-lifecycle-signal.js", "connector lifecycle signal script must run before dependent reliability scripts");
assert(manifest.content_scripts?.[0]?.js?.[2] === "composer-diagnostics.js", "composer diagnostics script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[3] === "stale-composer-recovery.js", "stale composer recovery script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[4] === "connector-continuity.js", "connector continuity script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[5] === "send-residual-recovery.js", "send residual recovery script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[6] === "markdown-copy.js", "markdown copy script must run before content.js");
assert(manifest.content_scripts?.[0]?.js?.[7] === "content.js", "content.js must remain a content script");

for (const size of [16, 32, 48, 128]) {
  assert(manifest.icons?.[size] === `icons/icon${size}.png`, `manifest icon${size} missing`);
  assert(manifest.action?.default_icon?.[size] === `icons/icon${size}.png`, `action.default_icon icon${size} missing`);
}
for (const size of ICON_SIZES) {
  const dimensions = await pngDimensions(path.join(distDir, "icons", `icon${size}.png`));
  assert(dimensions.width === size && dimensions.height === size, `icon${size}.png has wrong dimensions`);
}

const content = await readFile(path.join(distDir, "content.js"), "utf8");
for (const token of [
  "MICA_DIAGNOSTICS_START",
  "MICA_DIAGNOSTICS_STOP",
  "MICA_DIAGNOSTICS_COPY_REPORT",
  "MICA_DIAGNOSTICS_RESET",
  "MICA_COMPOSER_GUIDED_START",
  "MICA_COMPOSER_GUIDED_COPY_REPORT",
  "Native virtualization",
  "mountedTurns",
  "conversationTextIncluded: false",
  "attachmentContentIncluded: false",
  "autoDismissKnownInterruptions",
  "longThreadOptimization",
  "connectorContinuity",
  "sendResidualRecovery",
  "micaMarkdownCopy",
  "MICA_PREPARE_FINAL_SEND_CHECK",
  "knownInterruptions",
  "MicaConnectorLifecycleSignal",
  "MicaStaleComposerRecovery",
  "MicaConnectorContinuity",
  "MicaSendResidualRecovery",
  "MicaMarkdownCopy"
]) {
  assert(content.includes(token), `content.js missing ${token}`);
}
const reportBody = extractFunctionBody(content, "buildDiagnosticsReport");
assert(!/innerText|textContent|innerHTML|outerHTML/.test(reportBody), "diagnostics report builder must not read conversation text/html");

const interruptions = await readFile(path.join(distDir, "known-interruptions.js"), "utf8");
for (const token of [
  "chatgpt.rate_limit_history_ack.zh-CN.v1",
  "MicaKnownInterruptions",
  "WeakSet",
  "访问对话记录",
  "明白了"
]) {
  assert(interruptions.includes(token), `known-interruptions.js missing ${token}`);
}

const composerDiagnostics = await readFile(path.join(distDir, "composer-diagnostics.js"), "utf8");
for (const token of [
  "MicaComposerDiagnostics",
  "composer-capture-diagnostics.v3",
  "sendLifecycle",
  "userTurnCommittedLatched",
  "userTurnCommitSignalObserved",
  "userTurnDeltaHistory",
  "SEND_CLEARED_STABLE",
  "SEND_STALE_PAYLOAD_REAPPEARED",
  "SEND_NONMATCHING_TEXT_PRESENT",
  "SEND_NOT_COMMITTED",
  "INSUFFICIENT_SEND_EVIDENCE",
  "staleTextRestoredAfterClear",
  "staleTextAfterUserTurn",
  "clearAnchor",
  "mentionSignalSource",
  "connectorContinuityActivated",
  "sendResidualRecoveryAttemptCount",
  "connectorLifecycleLatched",
  "connectorContextLatched",
  "chooserActiveNow",
  "selectionWindowActive",
  "send_candidate_created",
  "send_candidate_promoted",
  "send_candidate_discarded",
  "CONNECTOR_SELECTION",
  "overlayHandlerAttached",
  "lastOverlayActionReceived",
  "lastOverlayActionSessionId",
  "lastOverlayActionResult",
  "sendResidualRecoverySkippedReason",
  "sendResidualRecoveryStaleProvenanceMatched",
  "coalescedLowPriorityEvents",
  "droppedLowPriorityEvents",
  "isHighPriorityEvent",
  "EXPECTED_NATIVE_LIKE_REMOUNT",
  "REMOUNT_WITH_TEXT",
  "promptTextIncluded: false",
  "answerTextIncluded: false",
  "requestDataIncluded: false",
  "rawDomIncluded: false"
]) {
  assert(composerDiagnostics.includes(token), `composer-diagnostics.js missing ${token}`);
}
assert(!/dispatchEvent\(|\.click\(|fetch\(|XMLHttpRequest|new\s+MutationObserver/.test(composerDiagnostics), "composer diagnostics must stay passive and local");
assert(!/dataset\.micaComposerDiagnosticsRoot|createElement\(\"div\"\)[\s\S]{0,240}micaComposerDiagnosticsRoot/.test(composerDiagnostics), "composer diagnostics must not create an independent page panel");
const connectorLifecycleSignal = await readFile(path.join(distDir, "connector-lifecycle-signal.js"), "utf8");
for (const token of [
  "MicaConnectorLifecycleSignal",
  "connectorLifecycleLatched",
  "mica-connector-lifecycle-latched",
  "chooserActiveNow",
  "connectorContextLatched",
  "selectionWindowActive",
  "mention-trigger",
  "findActiveMentionChooser",
  "latchConnectorLifecycle",
  "LATCH_TTL_MS"
]) {
  assert(connectorLifecycleSignal.includes(token), `connector-lifecycle-signal.js missing ${token}`);
}
assert(!/preventDefault\(|fetch\(|XMLHttpRequest|new\s+MutationObserver|document\.execCommand|\.click\(/.test(connectorLifecycleSignal), "connector lifecycle signal must stay observational and non-invasive");
const staleRecovery = await readFile(path.join(distDir, "stale-composer-recovery.js"), "utf8");
for (const token of [
  "MicaStaleComposerRecovery",
  "stale_recovery_full_clear_intent",
  "stale_recovery_clear_confirmation_started",
  "stale_recovery_clear_confirmation_check",
  "stale_recovery_clear_confirmation_expired",
  "stale_recovery_clear_confirmed",
  "clearConfirmationSource",
  "clearConfirmedTargetMatched",
  "stale_recovery_rearmed",
  "stale_recovery_armed",
  "stale_recovery_waiting_for_settle",
  "stale_recovery_match",
  "stale_recovery_cancelled_new_input",
  "stale_recovery_attempt",
  "stale_recovery_success",
  "stale_recovery_quiet_window_started",
  "stale_recovery_quiet_window_reset",
  "stale_recovery_failed",
  "stale_recovery_expired",
  "QUIET_WINDOW_MS",
  "GUARD_DURATION_MS",
  "MAX_ATTEMPTS"
]) {
  assert(staleRecovery.includes(token), `stale-composer-recovery.js missing ${token}`);
}
assert(!/fetch\(|XMLHttpRequest|new\s+MutationObserver|location\.reload|innerHTML\s*=|textContent\s*=/.test(staleRecovery), "stale recovery must stay bounded and avoid invasive DOM/network behavior");

const connectorContinuity = await readFile(path.join(distDir, "connector-continuity.js"), "utf8");
for (const token of [
  "MicaConnectorContinuity",
  "connector_continuity_activation_candidate",
  "connector_continuity_shell_shown",
  "connector_continuity_shell_removed",
  "createSanitizedComposerClone",
  "micaConnectorContinuityClone",
  "selectionWindowOnly",
  "SHELL_HARD_CAP_MS",
  "WATCH_WINDOW_MS",
  "skippedReason",
  "pointerEvents",
  "MutationObserver",
  "scheduleSnapshotRefresh",
  "activePollingTimer: false",
  "setEnabled"
]) {
  assert(connectorContinuity.includes(token), `connector-continuity.js missing ${token}`);
}
assert(!/preventDefault\(|fetch\(|XMLHttpRequest|document\.execCommand|\.click\(|setInterval\(|addEventListener\(\"(?:beforeinput|input|keydown|compositionstart|compositionupdate|compositionend)\"/.test(connectorContinuity), "connector continuity must stay visual-only, event-coalesced, and off the typing hot path");

const sendResidualRecovery = await readFile(path.join(distDir, "send-residual-recovery.js"), "utf8");
for (const token of [
  "MicaSendResidualRecovery",
  "send_residual_pre_send_captured",
  "send_residual_commit_latched",
  "send_residual_same_payload_reappeared",
  "send_residual_recovery_attempt",
  "send_residual_recovery_success",
  "send_residual_cancelled_new_input",
  "send_residual_armed",
  "MAX_ATTEMPTS",
  "HARD_LIFETIME_MS",
  "NONMATCHING_GRACE_MS",
  "MIN_PARTIAL_RESIDUAL_LENGTH",
  "waiting_for_clear_or_remount",
  "observedComposerClearPath",
  "postSendRemountPath",
  "recoveryEvidencePath",
  "partial_substring",
  "connector_body_subset",
  "detectMentionSignal"
]) {
  assert(sendResidualRecovery.includes(token), `send-residual-recovery.js missing ${token}`);
}
assert(!/preventDefault\(|fetch\(|XMLHttpRequest|new\s+MutationObserver|location\.reload|innerHTML\s*=/.test(sendResidualRecovery), "send residual recovery must stay bounded and avoid invasive DOM/network behavior");
const markdownCopy = await readFile(path.join(distDir, "markdown-copy.js"), "utf8");
for (const token of [
  "MicaMarkdownCopy",
  "serializeTurn",
  "DISPLAY_MATH_DELIMITER",
  "data-mica-copy-action",
  "annotation[encoding='application/x-tex']",
  "$$"
]) {
  assert(markdownCopy.includes(token), `markdown-copy.js missing ${token}`);
}
assert(!/setInterval\(|new\s+MutationObserver|addEventListener\(\"(?:beforeinput|input|keydown|compositionstart|compositionupdate|compositionend)\"|requestSubmit|form\.submit|fetch\(|XMLHttpRequest/.test(markdownCopy), "markdown copy must run only on explicit copy action and avoid send/network hooks");
for (const forbidden of ["radix-_", "btn-primary", "[role=\"dialog\"] button", "location.reload", "fetch(", "XMLHttpRequest"]) {
  assert(!interruptions.includes(forbidden), `known-interruptions.js contains forbidden dependency or behavior: ${forbidden}`);
}

const popupHtml = await readFile(path.join(distDir, "popup", "index.html"), "utf8");
for (const token of ["Performance", "Copy", "Reliability", "Run one-shot diagnostics", "Copy report", "Reset", "Advanced", "Prepare final send check", "Display equations as $$...$$"]) {
  assert(popupHtml.includes(token), `popup missing ${token}`);
}
assert(!popupHtml.includes("Start diagnostics"), "popup should not expose the old engineering diagnostics grid");

console.log("Build validation passed");

async function assertFile(file) {
  const info = await stat(file);
  assert(info.isFile(), `${file} is not a file`);
}

async function pngDimensions(file) {
  const buffer = await readFile(file);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${file} is not a PNG`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function extractFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
