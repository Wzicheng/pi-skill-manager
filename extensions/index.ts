import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type CacheEntry = {
	description_en: string;
	description_zh: string;
	path: string;
	updatedAt: string;
};

export type CacheFile = Record<string, CacheEntry>;

type RefreshState = {
	running: boolean;
	total: number;
	processed: number;
	translated: number;
	reused: number;
	failed: number;
	current: string;
	startedAt: number;
	lastMessage: string;
	modelLabel: string;
};

type FailureEntry = {
	skill: string;
	error: string;
	description_en: string;
	timestamp: string;
};

export type PackageGroup = {
	key: string;
	label: string;
	skills: SlashCommandInfo[];
};

export type PackageSummary = {
	key: string;
	label: string;
	total: number;
	translated: number;
	untranslated: number;
	skills: SlashCommandInfo[];
};

const CACHE_PATH = path.join(os.homedir(), ".pi", "agent", "skill-translations.json");
const ERROR_LOG_PATH = path.join(os.homedir(), ".pi", "agent", "skill-translations-last-errors.json");
const STATUS_KEY = "skill-zh-helper";
const DEFAULT_STATUS = "Skills-ZH 就绪";
const TRANSLATION_TIMEOUT_MS = 30000;

export default function skillZhHelper(pi: ExtensionAPI) {
	let refreshState: RefreshState = createIdleState();

	pi.on("session_start", async (_event, ctx) => {
		setStatus(ctx, DEFAULT_STATUS);
	});

	pi.registerCommand("skills-zh", {
		description: "按包查看 skill 的中文说明；支持 refresh / all / untranslated 子命令",
		handler: async (args, ctx) => {
			const raw = args.trim();
			const [firstToken, ...restTokens] = raw.split(/\s+/).filter(Boolean);
			if (firstToken?.toLowerCase() === "refresh") {
				await refreshTranslations(restTokens.join(" "), ctx);
				return;
			}
			if (firstToken?.toLowerCase() === "all") {
				await showAllSkills(ctx);
				return;
			}

			const query = raw.toLowerCase();
			const cache = await loadCache();
			const allSkills = getSkillCommands(pi);

			if (allSkills.length === 0) {
				ctx.ui.notify("当前没有可用的 skill", "info");
				return;
			}

			if (query === "untranslated" || query === "pending" || query === "todo") {
				await showUntranslatedPackages(ctx, allSkills, cache);
				return;
			}

			if (query) {
				const matchedSkills = getSkillCommands(pi, query);
				if (matchedSkills.length === 0) {
					ctx.ui.notify(`未找到匹配的 skill：${query}`, "warning");
					return;
				}

				await showSkillSelection(ctx, matchedSkills, cache, `Skills 中文说明：${query}`);
				return;
			}

			await showPackageSelection(ctx, allSkills, cache);
		},
	});

	async function showAllSkills(ctx: any) {
		const skills = getSkillCommands(pi);
		if (skills.length === 0) {
			ctx.ui.notify("当前没有可用的 skill", "info");
			return;
		}

		const cache = await loadCache();
		const lines: string[] = [];
		for (const group of groupSkillsByPackage(skills)) {
			const translatedCount = group.skills.filter((skill) => cache[toSkillKey(skill)]?.description_zh).length;
			lines.push(`--- ${group.label} (${group.skills.length})｜已翻译 ${translatedCount} ---`);
			for (const skill of group.skills) {
				const zh = cache[toSkillKey(skill)]?.description_zh || "[未翻译]";
				lines.push(`${formatSkillName(skill)}｜${zh}`);
			}
			lines.push("");
		}
		ctx.ui.notify(lines.join("\n"), "info");
	}

	pi.registerCommand("skill-zh", {
		description: "查看单个 skill 的中英文说明，用法：/skill-zh <skill-name>",
		getArgumentCompletions: (prefix) => {
			const value = prefix.trim().toLowerCase();
			const skills = getSkillCommands(pi)
				.map((skill) => ({ value: skill.name.replace(/^skill:/, ""), label: `/${skill.name}` }))
				.filter((item) => item.value.toLowerCase().startsWith(value));
			return skills.length > 0 ? skills : null;
		},
		handler: async (args, ctx) => {
			const query = normalizeSkillArg(args);
			if (!query) {
				ctx.ui.notify("用法：/skill-zh <skill-name>", "warning");
				return;
			}

			const skill = findSkill(pi, query);
			if (!skill) {
				ctx.ui.notify(`未找到 skill：${query}`, "warning");
				return;
			}

			const cache = await loadCache();
			showSkillDetails(ctx, skill, cache);
		},
	});

	pi.registerCommand("skills-zh-status", {
		description: "查看当前翻译任务状态，以及按包组织的翻译覆盖情况",
		handler: async (_args, ctx) => {
			const cache = await loadCache();
			const skills = getSkillCommands(pi);
			const translated = skills.filter((skill) => cache[toSkillKey(skill)]?.description_zh).sort((a, b) => a.name.localeCompare(b.name));
			const untranslated = skills.filter((skill) => !cache[toSkillKey(skill)]?.description_zh).sort((a, b) => a.name.localeCompare(b.name));
			const packageSummary = summarizePackageCoverage(skills, cache);
			const lines = [
				formatRefreshState(refreshState),
				"",
				`整体翻译覆盖: ${translated.length}/${skills.length}`,
				`已翻译: ${translated.length}`,
				`未翻译: ${untranslated.length}`,
				"统计范围: 当前 pi 已注册的 skill commands",
			];

			if (packageSummary.length > 0) {
				lines.push("");
				lines.push("按包统计:");
				for (const item of packageSummary) {
					lines.push(`- ${item.label}: ${item.translated}/${item.total}（未翻译 ${item.untranslated}）`);
				}
			}

			if (untranslated.length > 0) {
				lines.push("");
				lines.push("未翻译 package:");
				for (const item of packageSummary.filter((entry) => entry.untranslated > 0)) {
					lines.push(`- ${item.label}: ${item.untranslated}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), untranslated.length > 0 ? "warning" : "info");
		},
	});

	async function refreshTranslations(args: string, ctx: any) {
		if (refreshState.running) {
			ctx.ui.notify(
				`已有翻译任务在执行中。\n${formatRefreshState(refreshState)}\n请等待完成，或用 /skills-zh-status 查看状态。`,
				"warning",
			);
			return;
		}

		if (!ctx.model) {
			ctx.ui.notify("当前没有选中的模型。请先执行 /model 选择一个可用模型。", "warning");
			return;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok) {
			ctx.ui.notify(`模型认证失败：${auth.error}`, "warning");
			return;
		}
		if (!auth.apiKey) {
			ctx.ui.notify(`当前模型 ${ctx.model.provider}/${ctx.model.id} 没有可用凭证。请先 /login 或配置 API key。`, "warning");
			return;
		}

		const query = normalizeSkillArg(args);
		const skills = query ? ([findSkill(pi, query)].filter(Boolean) as SlashCommandInfo[]) : getSkillCommands(pi);

		if (skills.length === 0) {
			ctx.ui.notify(query ? `未找到 skill：${query}` : "没有可翻译的 skill", "warning");
			return;
		}

		const cache = await loadCache();
		const failures: FailureEntry[] = [];
		await clearFailureLog();
		refreshState = {
			running: true,
			total: skills.length,
			processed: 0,
			translated: 0,
			reused: 0,
			failed: 0,
			current: "准备开始",
			startedAt: Date.now(),
			lastMessage: `待处理 ${skills.length} 个 skill`,
			modelLabel: `${ctx.model.provider}/${ctx.model.id}`,
		};
		setStatus(ctx, buildStatusText(refreshState));
		ctx.ui.notify(
			`开始使用模型 ${refreshState.modelLabel} 翻译 ${skills.length} 个 skill。\n可随时使用 /skills-zh-status 查看进度。\n执行期间重复触发会被拦截，避免重复运行。`,
			"info",
		);

		try {
			for (const skill of skills) {
				const english = (skill.description || "").trim();
				refreshState.current = formatSkillName(skill);
				setStatus(ctx, buildStatusText(refreshState));

				if (!english) {
					refreshState.processed += 1;
					refreshState.failed += 1;
					refreshState.lastMessage = `${formatSkillName(skill)} 缺少 description，无法翻译`;
					setStatus(ctx, buildStatusText(refreshState));
					continue;
				}

				const key = toSkillKey(skill);
				const existing = cache[key];
				if (existing && existing.description_en === english) {
					refreshState.processed += 1;
					refreshState.reused += 1;
					refreshState.lastMessage = `${formatSkillName(skill)} 复用缓存`;
					setStatus(ctx, buildStatusText(refreshState));
					continue;
				}

				try {
					const zh = await translateTextWithModel({
						model: ctx.model,
						apiKey: auth.apiKey,
						headers: auth.headers,
						text: english,
						skillName: formatSkillName(skill),
					});
					cache[key] = {
						description_en: english,
						description_zh: zh,
						path: skill.sourceInfo.path,
						updatedAt: new Date().toISOString(),
					};
					refreshState.translated += 1;
					refreshState.lastMessage = `${formatSkillName(skill)} 翻译完成`;
				} catch (error) {
					const message = getErrorMessage(error);
					refreshState.failed += 1;
					refreshState.lastMessage = `${formatSkillName(skill)} 翻译失败：${message}`;
					failures.push({
						skill: formatSkillName(skill),
						error: message,
						description_en: english,
						timestamp: new Date().toISOString(),
					});
					ctx.ui.notify(`翻译失败: ${formatSkillName(skill)}\n${message}`, "warning");
				} finally {
					refreshState.processed += 1;
					setStatus(ctx, buildStatusText(refreshState));
				}
			}

			await saveCache(cache);
			await saveFailureLog(failures);
			const summaryLines = [
				`翻译任务完成`,
				`模型: ${refreshState.modelLabel}`,
				`总数: ${refreshState.total}`,
				`新增翻译: ${refreshState.translated}`,
				`复用缓存: ${refreshState.reused}`,
				`失败: ${refreshState.failed}`,
				`缓存文件: ${CACHE_PATH}`,
			];
			if (failures.length > 0) {
				summaryLines.push(`本次失败项文件: ${ERROR_LOG_PATH}`);
				summaryLines.push(`可单独重试：/skills-zh refresh <skill-name>`);
			}
			ctx.ui.notify(summaryLines.join("\n"), refreshState.failed > 0 ? "warning" : "info");
		} finally {
			refreshState = createIdleState();
			setStatus(ctx, DEFAULT_STATUS);
		}
	}
}

async function showPackageSelection(
	ctx: { ui: { select(title: string, items: string[]): Promise<string | null> } },
	allSkills: SlashCommandInfo[],
	cache: CacheFile,
): Promise<void> {
	const packages = summarizePackageCoverage(allSkills, cache);
	const items = packages.map((entry) => `${entry.label}（${entry.total}）｜已翻译 ${entry.translated}`);
	const selected = await ctx.ui.select("选择 skill 包", items);
	if (!selected) return;

	const packageLabel = selected.split("（")[0].trim();
	const selectedGroup = packages.find((entry) => entry.label === packageLabel);
	if (!selectedGroup) return;

	await showSkillSelection(ctx as any, selectedGroup.skills, cache, `${selectedGroup.label}（${selectedGroup.total}）`);
}

async function showUntranslatedPackages(
	ctx: { ui: { select(title: string, items: string[]): Promise<string | null>; notify(message: string, level?: string): void } },
	allSkills: SlashCommandInfo[],
	cache: CacheFile,
): Promise<void> {
	const packages = summarizePackageCoverage(allSkills, cache).filter((entry) => entry.untranslated > 0);
	if (packages.length === 0) {
		ctx.ui.notify("当前所有已注册 skills 都已有中文说明。", "info");
		return;
	}

	const items = packages.map((entry) => `${entry.label}（未翻译 ${entry.untranslated}/${entry.total}）`);
	const selected = await ctx.ui.select("选择未翻译 skill 包", items);
	if (!selected) return;

	const packageLabel = selected.split("（")[0].trim();
	const selectedGroup = packages.find((entry) => entry.label === packageLabel);
	if (!selectedGroup) return;

	const untranslatedSkills = selectedGroup.skills.filter((skill) => !cache[toSkillKey(skill)]?.description_zh);
	await showSkillSelection(ctx, untranslatedSkills, cache, `${selectedGroup.label} 未翻译 skills（${untranslatedSkills.length}）`);
}

async function showSkillSelection(
	ctx: { ui: { select(title: string, items: string[]): Promise<string | null>; notify(message: string, level?: string): void } },
	skills: SlashCommandInfo[],
	cache: CacheFile,
	title: string,
): Promise<void> {
	const items = skills.map((skill) => {
		const zh = cache[toSkillKey(skill)]?.description_zh || "[未翻译] 先执行 /skills-zh refresh";
		return `${formatSkillName(skill)}｜${zh}`;
	});

	const selected = await ctx.ui.select(title, items);
	if (!selected) return;

	const selectedName = normalizeSkillArg(selected.split("｜")[0]);
	const skill = skills.find((item) => normalizeSkillArg(item.name) === selectedName);
	if (!skill) return;

	showSkillDetails(ctx, skill, cache);
}

function showSkillDetails(
	ctx: { ui: { notify(message: string, level?: string): void } },
	skill: SlashCommandInfo,
	cache: CacheFile,
): void {
	const cached = cache[toSkillKey(skill)];
	const packageGroup = inferPackageGroup(skill);
	const lines = [
		`名称: ${formatSkillName(skill)}`,
		`包: ${packageGroup.label}`,
		`英文说明: ${skill.description || "(无说明)"}`,
		`中文说明: ${cached?.description_zh || "(尚未翻译，请先执行 /skills-zh refresh)"}`,
		`路径: ${skill.sourceInfo.path}`,
	];
	ctx.ui.notify(lines.join("\n"), "info");
}

export function groupSkillsByPackage(skills: SlashCommandInfo[]): PackageGroup[] {
	const groups = new Map<string, PackageGroup>();
	for (const skill of skills) {
		const inferred = inferPackageGroup(skill);
		const existing = groups.get(inferred.key);
		if (existing) {
			existing.skills.push(skill);
			continue;
		}
		groups.set(inferred.key, { ...inferred, skills: [skill] });
	}

	return [...groups.values()]
		.map((group) => ({
			...group,
			skills: [...group.skills].sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export function summarizePackageCoverage(skills: SlashCommandInfo[], cache: CacheFile): PackageSummary[] {
	return groupSkillsByPackage(skills).map((group) => {
		const translated = group.skills.filter((skill) => cache[toSkillKey(skill)]?.description_zh).length;
		return {
			key: group.key,
			label: group.label,
			total: group.skills.length,
			translated,
			untranslated: group.skills.length - translated,
			skills: group.skills,
		};
	});
}

export function inferPackageGroup(skill: SlashCommandInfo): Omit<PackageGroup, "skills"> {
	const sourcePath = skill.sourceInfo?.path || "";
	const normalizedPath = normalizePath(sourcePath);
	if (!normalizedPath) return { key: "other", label: "other" };

	const known = inferKnownPackage(normalizedPath);
	if (known) return known;

	const heuristic = inferPackageFromPath(normalizedPath);
	if (heuristic) return heuristic;

	return { key: "other", label: "other" };
}

function inferKnownPackage(normalizedPath: string): Omit<PackageGroup, "skills"> | null {
	if (/\/.pi\/agent\/skills\/ce-[^/]+\//.test(normalizedPath)) {
		return { key: "ce", label: "CE skills" };
	}

	const skillMatch = normalizedPath.match(/\/.pi\/agent\/skills\/([^/]+)\//);
	if (skillMatch?.[1]) {
		return { key: slugify(skillMatch[1]), label: skillMatch[1] };
	}

	return null;
}

function inferPackageFromPath(normalizedPath: string): Omit<PackageGroup, "skills"> | null {
	const segments = normalizedPath.split("/").filter(Boolean);
	const ignored = new Set([
		"users",
		"user",
		"prince",
		".pi",
		"agent",
		"skills",
		"extensions",
		"src",
		"dist",
		"build",
		"lib",
		"tmp",
		"var",
		"private",
	]);
	const blacklist = new Set(["index.ts", "index.js", "skill.md", "readme.md"]);

	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const segment = segments[index]!;
		const lower = segment.toLowerCase();
		if (blacklist.has(lower)) continue;
		if (ignored.has(lower)) continue;
		if (!/[a-z]/i.test(segment)) continue;
		if (segment.length <= 2) continue;
		if (segment.includes(".")) continue;
		return { key: slugify(segment), label: segment };
	}

	return null;
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/").trim();
}

function slugify(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "other";
}

function getSkillCommands(pi: ExtensionAPI, filter = ""): SlashCommandInfo[] {
	const normalized = filter.trim().toLowerCase();
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.filter((command) => {
			if (!normalized) return true;
			return command.name.toLowerCase().includes(normalized) || (command.description || "").toLowerCase().includes(normalized);
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

function findSkill(pi: ExtensionAPI, query: string): SlashCommandInfo | undefined {
	const normalized = normalizeSkillArg(query);
	return getSkillCommands(pi).find((skill) => normalizeSkillArg(skill.name) === normalized);
}

function normalizeSkillArg(value: string): string {
	return value.trim().split("｜")[0].trim().replace(/^\//, "").replace(/^skill:/, "").toLowerCase();
}

function toSkillKey(skill: SlashCommandInfo): string {
	return skill.name.startsWith("skill:") ? skill.name : `skill:${skill.name}`;
}

function formatSkillName(skill: SlashCommandInfo): string {
	return `/${skill.name.startsWith("skill:") ? skill.name : `skill:${skill.name}`}`;
}

function createIdleState(): RefreshState {
	return {
		running: false,
		total: 0,
		processed: 0,
		translated: 0,
		reused: 0,
		failed: 0,
		current: "",
		startedAt: 0,
		lastMessage: "空闲",
		modelLabel: "",
	};
}

function formatRefreshState(state: RefreshState): string {
	if (!state.running) return "当前没有翻译任务在执行。";
	const elapsed = Math.max(1, Math.floor((Date.now() - state.startedAt) / 1000));
	return [
		"翻译任务进行中",
		`模型: ${state.modelLabel}`,
		`进度: ${state.processed}/${state.total}`,
		`当前: ${state.current || "(准备中)"}`,
		`新增翻译: ${state.translated}`,
		`复用缓存: ${state.reused}`,
		`失败: ${state.failed}`,
		`耗时: ${elapsed}s`,
		`最近状态: ${state.lastMessage}`,
	].join("\n");
}

function buildStatusText(state: RefreshState): string {
	if (!state.running) return DEFAULT_STATUS;
	const current = state.current ? ` ${state.current}` : "";
	return `技能翻译中 ${state.processed}/${state.total}｜新增 ${state.translated}｜缓存 ${state.reused}｜失败 ${state.failed}${current}`;
}

function setStatus(ctx: { ui: { setStatus(key: string, text: string): void } }, text: string): void {
	ctx.ui.setStatus(STATUS_KEY, text);
}

async function loadCache(): Promise<CacheFile> {
	try {
		const content = await fs.readFile(CACHE_PATH, "utf8");
		return JSON.parse(content) as CacheFile;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

async function saveCache(cache: CacheFile): Promise<void> {
	await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
	await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

async function saveFailureLog(failures: FailureEntry[]): Promise<void> {
	await fs.mkdir(path.dirname(ERROR_LOG_PATH), { recursive: true });
	await fs.writeFile(ERROR_LOG_PATH, `${JSON.stringify(failures, null, 2)}\n`, "utf8");
}

async function clearFailureLog(): Promise<void> {
	await saveFailureLog([]);
}

async function translateTextWithModel(params: {
	model: NonNullable<Parameters<typeof complete>[0]>;
	apiKey: string;
	headers?: Record<string, string>;
	text: string;
	skillName: string;
}): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

	try {
		const response = await complete(
			params.model,
			{
				systemPrompt:
					"你是一个面向中文开发者的 skill 命令说明翻译器。你的任务是把英文 skill description 翻译成自然、简洁、准确的简体中文。\n规则：\n1. 只输出翻译结果，不要解释，不要加引号。\n2. 保持用途导向，突出这个 skill 是做什么的、适合什么时候用。\n3. 语气简洁，像命令说明，不要写成长段文案。\n4. 保留 Git、PR、Figma、SDK、Rails 等常见技术词。\n5. 不要臆造原文没有的信息。",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `Skill: ${params.skillName}\nEnglish description: ${params.text}\n\n请翻译为简体中文说明：`,
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: params.apiKey,
				headers: params.headers,
				signal: controller.signal,
				reasoningEffort: "low",
			},
		);

		if (response.stopReason === "aborted") {
			throw new Error(`模型翻译超时（>${TRANSLATION_TIMEOUT_MS / 1000}s）`);
		}

		const translated = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (!translated) {
			throw new Error("模型返回了空结果");
		}

		return translated.replace(/^```[\s\S]*?\n/, "").replace(/```$/, "").trim();
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error(`模型翻译超时（>${TRANSLATION_TIMEOUT_MS / 1000}s）`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
