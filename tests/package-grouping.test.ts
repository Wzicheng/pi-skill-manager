import { describe, expect, it } from "vitest";
import { groupSkillsByPackage, inferPackageGroup, summarizePackageCoverage } from "../extensions/index.js";

type FakeSkill = {
	name: string;
	description?: string;
	source: string;
	sourceInfo: { path: string };
};

type FakeCache = Record<string, { description_zh?: string }>;

function skill(name: string, sourcePath: string, description = "desc"): FakeSkill {
	return {
		name,
		description,
		source: "skill",
		sourceInfo: { path: sourcePath },
	};
}

describe("inferPackageGroup", () => {
	it("groups CE skills under a stable ce label for known patterns", () => {
		const result = inferPackageGroup(skill("skill:ce-plan", "/Users/prince/.pi/agent/skills/ce-plan/SKILL.md") as any);
		expect(result.key).toBe("ce");
		expect(result.label).toBe("CE skills");
	});

	it("uses source root heuristics for extension packages", () => {
		const result = inferPackageGroup(skill("skill:pkg-skill", "/repo/packages/pi-skill-manage/dist/index.js") as any);
		expect(result.key).toBe("pi-skill-manage");
		expect(result.label).toBe("pi-skill-manage");
	});

	it("falls back to other when path is empty", () => {
		const result = inferPackageGroup(skill("skill:unknown", "") as any);
		expect(result.key).toBe("other");
		expect(result.label).toBe("other");
	});

	it("falls back to other for malformed generic paths", () => {
		const result = inferPackageGroup(skill("skill:unknown", "/tmp/index.ts") as any);
		expect(result.key).toBe("other");
	});

	it("skips generic parent directories when inferring package roots", () => {
		const result = inferPackageGroup(skill("skill:pkg-skill", "/repo/packages/pi-skill-manage/dist/index.js") as any);
		expect(result.key).toBe("pi-skill-manage");
		expect(result.label).toBe("pi-skill-manage");
	});
});

describe("groupSkillsByPackage", () => {
	it("groups multiple skills with the same inferred package key together", () => {
		const groups = groupSkillsByPackage([
			skill("skill:ce-plan", "/Users/prince/.pi/agent/skills/ce-plan/SKILL.md"),
			skill("skill:ce-work", "/Users/prince/.pi/agent/skills/ce-work/SKILL.md"),
			skill("skill:git-commit", "/Users/prince/.pi/agent/skills/git-commit/SKILL.md"),
		] as any);

		expect(groups.map((group) => group.key)).toEqual(["ce", "git-commit"]);
		expect(groups[0]?.skills).toHaveLength(2);
		expect(groups[1]?.skills).toHaveLength(1);
	});

	it("returns stable ordering across groups and skills", () => {
		const groups = groupSkillsByPackage([
			skill("skill:zeta", "/repo/pkg-a/zeta.ts"),
			skill("skill:alpha", "/repo/pkg-a/alpha.ts"),
			skill("skill:beta", "/repo/pkg-b/beta.ts"),
		] as any);

		expect(groups.map((group) => group.key)).toEqual(["pkg-a", "pkg-b"]);
		expect(groups[0]?.skills.map((entry) => entry.name)).toEqual(["skill:alpha", "skill:zeta"]);
	});
});

describe("summarizePackageCoverage", () => {
	it("derives translated and untranslated counts from per-skill cache", () => {
		const skills = [
			skill("skill:ce-plan", "/Users/prince/.pi/agent/skills/ce-plan/SKILL.md"),
			skill("skill:ce-work", "/Users/prince/.pi/agent/skills/ce-work/SKILL.md"),
			skill("skill:unknown", ""),
		] as any;
		const cache: FakeCache = {
			"skill:ce-plan": { description_zh: "中文" },
		};

		const summary = summarizePackageCoverage(skills, cache as any);
		expect(summary[0]).toMatchObject({ key: "ce", total: 2, translated: 1, untranslated: 1 });
		expect(summary[1]).toMatchObject({ key: "other", total: 1, translated: 0, untranslated: 1 });
	});
});
