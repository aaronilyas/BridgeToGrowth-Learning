// Entry point of the Claude ACP agent process. scripts/build.ts bundles it into dist/claude-acp.js; a source checkout runs this file directly.
// The adapter speaks ACP on stdout and runs the Claude Code CLI named by CLAUDE_CODE_EXECUTABLE (see claude.ts).
import "@agentclientprotocol/claude-agent-acp/dist/index.js";
