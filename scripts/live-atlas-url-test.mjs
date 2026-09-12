import { resolveExactTarget, validateAtlasThreadUrl } from "./live-atlas-cdp-core.mjs";
import { assert } from "./live-atlas-common.mjs";

const normal = "https://chatgpt.com/c/atlasNormal_123";
const project = "https://chatgpt.com/g/g-p-test/project/mica/c/atlasProject_456?model=gpt-5";

assert(validateAtlasThreadUrl(normal).conversationId === "atlasNormal_123", "normal conversation URL was rejected");
assert(validateAtlasThreadUrl(project).conversationId === "atlasProject_456", "project-scoped conversation URL was rejected");

for (const unsafe of [
  "http://chatgpt.com/c/not-https",
  "https://evil.example/c/atlas",
  "https://chatgpt.com/",
  "https://chatgpt.com/g/g-p-test/project/mica",
  "https://chatgpt.com/c/",
  "https://chat.openai.com/c/legacy-not-enabled"
]) {
  let rejected = false;
  try {
    validateAtlasThreadUrl(unsafe);
  } catch (_error) {
    rejected = true;
  }
  assert(rejected, `unsafe URL was accepted: ${unsafe}`);
}

const target = await resolveExactTarget({
  port: 9222,
  threadUrl: project,
  fetchImpl: async () => ({
    ok: true,
    json: async () => [
      { type: "page", url: normal, title: "normal", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/normal" },
      { type: "page", url: "https://chatgpt.com/c/atlasProject_456?model=gpt-5", title: "normalized-looking wrong", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/wrong" },
      { type: "page", url: project, title: "project exact", webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/project" }
    ]
  })
});

assert(target.url === project, "exact full project URL target was not selected");

console.log(JSON.stringify({
  passed: true,
  normalConversationId: validateAtlasThreadUrl(normal).conversationId,
  projectConversationId: validateAtlasThreadUrl(project).conversationId,
  exactTargetUrl: target.url,
  automatedSend: false,
  automatedUpload: false,
  automatedConnectorAction: false
}, null, 2));
