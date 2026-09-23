import { describe, expect, it } from "vitest";
import { estimateEntryTokens } from "../tokens.js";
import { isSourceEntry, rawTokensAfterIndex } from "./progress.js";
import { OM_OBSERVATIONS_RECORDED, type Entry } from "./types.js";
import { recallMemorySources } from "./recall.js";

describe("system messages are not continuous-memory sources", () => {
	const systemEntry: Entry = {
		type: "message",
		id: "system-1",
		message: { role: "system", content: "a large system prompt that must not trigger observation" },
	};
	const userEntry: Entry = {
		type: "message",
		id: "user-1",
		message: { role: "user", content: "remember this request" },
	};

	it("excludes system messages from source eligibility and observation token progress", () => {
		const customEntry: Entry = { type: "custom_message", id: "custom-1", content: "custom source" };
		const summaryEntry: Entry = { type: "branch_summary", id: "summary-1", summary: "summary source" };

		expect(isSourceEntry(systemEntry)).toBe(false);
		expect(estimateEntryTokens(systemEntry)).toBe(0);
		expect(rawTokensAfterIndex([systemEntry, userEntry, customEntry, summaryEntry], -1)).toBe(
			estimateEntryTokens(userEntry) + estimateEntryTokens(customEntry) + estimateEntryTokens(summaryEntry),
		);
	});

	it("does not return system messages as recalled memory evidence", () => {
		const observationId = "abcdef123456";
		const observationEntry: Entry = {
			type: "custom",
			id: "observation-1",
			customType: OM_OBSERVATIONS_RECORDED,
			data: {
				coversUpToId: "system-1",
				observations: [
					{
						id: observationId,
						content: "A remembered request",
						timestamp: "2026-09-12 08:00",
						relevance: "high",
						sourceEntryIds: ["system-1", "user-1"],
						tokenCount: 12,
					},
				],
			},
		};
		const result = recallMemorySources([systemEntry, userEntry, observationEntry], observationId);

		expect(result.status).toBe("found");
		if (result.status !== "found") return;
		expect(result.sourceEntries.map((entry) => entry.id)).toEqual(["user-1"]);
		expect(result.nonSourceEntryIds).toEqual([]);
		expect(result.partial).toBe(false);
		expect(result.observations[0]?.nonSourceEntryIds).toEqual([]);
		expect(result.observations[0]?.sourceEntryIds).toEqual(["user-1"]);

		const invalidResult = recallMemorySources(
			[{ ...systemEntry, type: "custom", customType: "metadata" }, userEntry, observationEntry],
			observationId,
		);
		expect(invalidResult.nonSourceEntryIds).toEqual(["system-1"]);
		expect(invalidResult.partial).toBe(true);
	});
});
