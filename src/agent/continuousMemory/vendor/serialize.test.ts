import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import {
	renderRecallSourceEntries,
	renderRecallSourceEntry,
	serializeBranchEntries,
	serializeConversation,
	serializeSourceAddressedBranchEntries,
	type RenderableEntry,
} from "./serialize.js";

function message(role: string, content: unknown, extra: Record<string, unknown> = {}): Message {
	return { role, content, timestamp: 1, ...extra } as unknown as Message;
}

describe("continuous-memory message serialization", () => {
	it("omits system messages instead of mislabeling them as tool results", () => {
		const system = message("system", "private system instructions");

		expect(serializeConversation([system])).toBe("");
		expect(serializeBranchEntries([{ type: "message", id: "system-1", message: system }])).toBe("");
		expect(renderRecallSourceEntry({ type: "message", id: "system-1", message: system })).toBeNull();
		expect(renderRecallSourceEntries([{ type: "message", id: "system-1", message: system }])).toBe("");
	});

	it("keeps user, assistant, tool-result, custom, and summary rendering", () => {
		const messages = [
			message("user", "hello"),
			message("assistant", "hi"),
			message("toolResult", "command completed", { toolName: "terminal" }),
		];
		const conversation = serializeConversation(messages);
		expect(conversation).toContain("[User @ ");
		expect(conversation).toContain("hello");
		expect(conversation).toContain("[Assistant @ ");
		expect(conversation).toContain("hi");
		expect(conversation).toContain("[Tool result for terminal @ ");
		expect(conversation).toContain("command completed");

		const entries: RenderableEntry[] = [
			{ type: "message", id: "system-1", message: message("system", "private system instructions") },
			{ type: "message", id: "user-1", message: messages[0] },
			{ type: "message", id: "tool-1", message: messages[2] },
			{ type: "custom_message", id: "custom-1", customType: "notice", content: "custom content" },
			{ type: "branch_summary", id: "summary-1", summary: "summary content" },
		];
		const addressed = serializeSourceAddressedBranchEntries(entries);
		expect(addressed.sourceEntryIds).toEqual(["user-1", "tool-1", "custom-1", "summary-1"]);
		expect(addressed.text).not.toContain("private system instructions");
		expect(addressed.text).toContain("[Tool result for terminal @ ");
		expect(addressed.text).toContain("[Custom (notice) @ ");
		expect(addressed.text).toContain("[Branch summary @ ");
	});

	it("does not render a system message when recalling source entries", () => {
		const system = {
			type: "message",
			id: "system-1",
			message: message("system", "private system instructions"),
		};
		const toolResult = {
			type: "message",
			id: "tool-1",
			message: message("toolResult", "result", { toolName: "terminal" }),
		};

		const rendered = renderRecallSourceEntries([system, toolResult]);
		expect(rendered).not.toContain("private system instructions");
		expect(rendered).toContain("[Tool result: terminal @ ");
	});
});
