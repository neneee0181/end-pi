import assert from "node:assert/strict";
import { getAccessTokenForProvider } from "../dist/pi-config.js";
import { __test } from "../dist/server.js";

const ctx = __test.responsesInputToPiContext([
  {
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: "DEVELOPER_RULE" }],
  },
  {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "hello" }],
  },
]);

assert.match(ctx.systemPrompt, /DEVELOPER_RULE/);
assert.equal(ctx.messages.length, 1);
assert.equal(ctx.messages[0].role, "user");

const image = __test.responsePartsToPiContent([
  { type: "input_image", image_url: "data:image/png;base64,abc123" },
]);
assert.deepEqual(image, [{ type: "image", mimeType: "image/png", data: "abc123" }]);

const tools = __test.responseToolsToPiTools([
  {
    type: "namespace",
    name: "codex_app",
    tools: [
      {
        name: "read_thread_terminal",
        description: "Read terminal output.",
        parameters: { type: "object", properties: {} },
      },
    ],
  },
]);
assert.equal(tools.length, 1);
assert.equal(tools[0].name, "codex_app__read_thread_terminal");
assert.match(tools[0].description, /Codex namespace: codex_app/);

const miss = __test.responsesInputToPiContext([
  {
    type: "function_call_output",
    call_id: "call_1",
    output: "Process exited with code 1\nOriginal token count: 0\nOutput:\n",
  },
]);
assert.match(miss.messages[0].content[0].text, /one exact search as exhaustive/i);

const googleKey = await getAccessTokenForProvider("google", {
  google: { type: "api_key", key: "test-google-key" },
});
assert.equal(googleKey, "test-google-key");

console.log("transform checks passed");
