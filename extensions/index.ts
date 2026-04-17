import type { ExtensionAPI, SlashCommandInfo } from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type CacheEntry = {
	description_en: string;
	description_zh: string;
	path: string;
	updatedAt: string;
};

type CacheFile = Record<string, CacheEntry>;

type SkillCategory = {
	key: string;
	label: string;
	keywords: string[];
};

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

const CACHE_PATH = path.join(os.homedir(), ".pi", "agent", "skill-translations.json");
const ERROR_LOG_PATH = path.join(os.homedir(), ".pi", "agent", "skill-translations-last-errors.json");
const STATUS_KEY = "skill-zh-helper";
const DEFAULT_STATUS = "Skills-ZH 就绪";
const TRANSLATION_TIMEOUT_MS = 30000;

const CATEGORIES: SkillCategory[] = [
	{ key: "git-pr", label: "Git / PR", keywords: ["git", "commit", "branch", "pr", "review thread", "pull request"] },
	{ key: "planning", label: "计划 / 脑暴 / 需求", keywords: ["plan", "brainstorm", "requirements", "spec", "scope", "ideate"] },
	{ key: "code-review", label: "代码审查", keywords: ["review", "reviewer", "audit", "correctness", "maintainability", "testing"] },
	{ key: "frontend", label: "前端 / 设计 / 浏览器", keywords: ["frontend", "design", "figma", "browser", "ui", "screenshot", "css"] },
	{ key: "security-reliability-performance", label: "安全 / 可靠性 / 性能", keywords: ["security", "reliability", "performance", "auth", "owasp", "failure"] },
	{ key: "data", label: "数据 / 数据库 / 迁移", keywords: ["data", "database", "schema", "migration", "backfill", "sql"] },
	{ key: "docs-research", label: "文档 / 研究 / Onboarding", keywords: ["document", "docs", "research", "onboarding", "readme", "proof"] },
	{ key: "agent-pi", label: "Agent / Pi / 扩展", keywords: ["agent", "pi", "extension", "sdk", "mcp", "tool", "skill"] },
	{ key: "other", label: "其他", keywords: [] },
];

export default function skillZhHelper(pi: ExtensionAPI) {
	let refreshState: RefreshState = createIdleState();

	pi.on("session_start", async (_event, ctx) => {
		setStatus(ctx, DEFAULT_STATUS);
	});

	pi.registerCommand("skills-zh", {
		description: "按分类查看 skill 的中文说明；支持 refresh / all 子命令",
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

			if (query) {
				const matchedCategory = findCategory(query);
				if (matchedCategory) {
					await showCategorySkills(ctx, allSkills, cache, matchedCategory);
					return;
				}

				const matchedSkills = getSkillCommands(pi, query);
				if (matchedSkills.length === 0) {
					const untranslated = allSkills.filter((skill) => !cache[toSkillKey(skill)]?.description_zh);
					if (query === "untranslated" || query === "pending" || query === "todo") {
						if (untranslated.length === 0) {
							ctx.ui.notify("当前所有已注册 skills 都已有中文说明。", "info");
							return;
						}
						await showSkillSelection(ctx, untranslated, cache, `未翻译 skills（${untranslated.length}）`);
						return;
					}
					ctx.ui.notify(`未找到匹配的分类或 skill：${query}`, "warning");
					return;
				}

				await showSkillSelection(ctx, matchedSkills, cache, `Skills 中文说明：${query}`);
				return;
			}

			const categorized = categorizeSkills(allSkills);
			const categoryItems = categorized.map(({ category, skills }) => {
				const translatedCount = skills.filter((skill) => cache[toSkillKey(skill)]?.description_zh).length;
				return `${category.label}（${skills.length}）｜已翻译 ${translatedCount}`;
			});

			const selected = await ctx.ui.select("选择 skill 分类", categoryItems);
			if (!selected) return;

			const categoryLabel = selected.split("（")[0].trim();
			const category = CATEGORIES.find((item) => item.label === categoryLabel);
			if (!category) return;

			await showCategorySkills(ctx, allSkills, cache, category);
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
		for (const { category, skills: group } of categorizeSkills(skills)) {
			lines.push(`--- ${category.label} (${group.length}) ---`);
			for (const skill of group) {
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
		description: "查看当前翻译任务状态，以及整体翻译覆盖情况",
		handler: async (_args, ctx) => {
			const cache = await loadCache();
			const skills = getSkillCommands(pi);
			const translated = skills.filter((skill) => cache[toSkillKey(skill)]?.description_zh).sort((a, b) => a.name.localeCompare(b.name));
			const untranslated = skills.filter((skill) => !cache[toSkillKey(skill)]?.description_zh).sort((a, b) => a.name.localeCompare(b.name));
			const lines = [
				formatRefreshState(refreshState),
				"",
				`整体翻译覆盖: ${translated.length}/${skills.length}`,
				`已翻译: ${translated.length}`,
				`未翻译: ${untranslated.length}`,
				"统计范围: 当前 pi 已注册的 skill commands",
			];

			if (untranslated.length > 0) {
				lines.push("");
				lines.push("未翻译 skills:");
				for (const skill of untranslated.slice(0, 50)) {
					lines.push(`- ${formatSkillName(skill)}`);
				}
				if (untranslated.length > 50) {
					lines.push(`- ... 其余 ${untranslated.length - 50} 个未翻译 skill`);
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

async function showCategorySkills(
	ctx: { ui: { select(title: string, items: string[]): Promise<string | null> } },
	allSkills: SlashCommandInfo[],
	cache: CacheFile,
	category: SkillCategory,
): Promise<void> {
	const skills = categorizeSkills(allSkills).find((group) => group.category.key === category.key)?.skills ?? [];
	if (skills.length === 0) return;
	await showSkillSelection(ctx, skills, cache, `${category.label}（${skills.length}）`);
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
	const category = getCategoryForSkill(skill).label;
	const lines = [
		`名称: ${formatSkillName(skill)}`,
		`分类: ${category}`,
		`英文说明: ${skill.description || "(无说明)"}`,
		`中文说明: ${cached?.description_zh || "(尚未翻译，请先执行 /skills-zh refresh)"}`,
		`路径: ${skill.sourceInfo.path}`,
	];
	ctx.ui.notify(lines.join("\n"), "info");
}

function categorizeSkills(skills: SlashCommandInfo[]): Array<{ category: SkillCategory; skills: SlashCommandInfo[] }> {
	const groups = new Map<string, SlashCommandInfo[]>();
	for (const category of CATEGORIES) groups.set(category.key, []);

	for (const skill of skills) {
		const category = getCategoryForSkill(skill);
		groups.get(category.key)?.push(skill);
	}

	return CATEGORIES.map((category) => ({
		category,
		skills: (groups.get(category.key) || []).sort((a, b) => a.name.localeCompare(b.name)),
	})).filter((group) => group.skills.length > 0);
}

function getCategoryForSkill(skill: SlashCommandInfo): SkillCategory {
	const haystack = `${skill.name} ${(skill.description || "")}`.toLowerCase();
	for (const category of CATEGORIES) {
		if (category.key === "other") continue;
		if (category.key === "git-pr" && /^skill:git-|^git-/.test(skill.name)) return category;
		if (category.key === "planning" && /^(skill:)?ce-(brainstorm|plan|ideate)\b/.test(skill.name)) return category;
		if (category.key === "frontend" && /^(skill:)?(frontend|design|figma|test-browser|gstack|agent-browser)\b/.test(skill.name)) return category;
		if (category.key === "code-review" && /review/.test(skill.name)) return category;
		if (category.keywords.some((keyword) => haystack.includes(keyword))) return category;
	}
	return CATEGORIES.find((category) => category.key === "other")!;
}

function findCategory(query: string): SkillCategory | undefined {
	const normalized = query.trim().toLowerCase();
	return CATEGORIES.find((category) => {
		const label = category.label.toLowerCase();
		return category.key === normalized || label.includes(normalized) || category.keywords.some((k) => k.includes(normalized));
	});
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
