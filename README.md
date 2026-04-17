# pi-skill-manage

Manage, browse, and enrich pi skills — with Chinese translation as one of the built-in capabilities.

用于管理、浏览和增强 pi skills 的扩展，中文翻译只是其中一个内置能力。

## 快速开始

```bash
pi install /Users/prince/github/extension/pi-skill-manage
```

然后在 pi 中执行：

```bash
/reload
/skills-zh-status
/skills-zh
```

如果要刷新翻译缓存：

```bash
/skills-zh refresh
```

如果只想补齐某一个 skill：

```bash
/skills-zh refresh git-commit
```

## 当前能力

当前版本主要提供以下能力：

- 浏览当前已注册的 skills
- 按安装包 / 来源包查看 skills
- 查看单个 skill 的中英文说明
- 使用当前选中的模型把英文 description 翻译成中文
- 将翻译结果缓存在本地，避免重复翻译
- 查看当前翻译进度、整体覆盖情况与按包覆盖情况
- 按包检查未翻译 skills，并支持按需补齐

## 命令

- `/skills-zh`：按包查看当前 skills
- `/skills-zh refresh`：刷新全部翻译缓存
- `/skills-zh refresh <skill-name>`：刷新单个 skill
- `/skills-zh all`：按包展开全部 skills
- `/skills-zh untranslated`：按包查看未翻译 skills
- `/skill-zh <skill-name>`：查看单个 skill 的中英文说明
- `/skills-zh-status`：查看当前任务状态、整体翻译覆盖率和按包覆盖情况

## 设计原则

- 不修改原始 skill 文件
- 基于 skill 来源路径自动推断 package 分组，无法可靠识别时归入 `other`
- 基于当前 pi 模型翻译，而不是依赖固定外部翻译接口
- 增量缓存：英文 description 不变时直接复用缓存
- 任务状态可见：支持状态栏和任务进度
- 防重复执行：翻译任务运行中会拦截重复触发
- 保持命令克制：优先增强现有命令，而不是不断新增命令

## 本地文件

默认会写入：

- 缓存：`~/.pi/agent/skill-translations.json`
- 最近一次失败项：`~/.pi/agent/skill-translations-last-errors.json`

## 安装

### 从本地目录安装

```bash
pi install /absolute/path/to/pi-skill-manage
```

例如：

```bash
pi install /Users/prince/github/extension/pi-skill-manage
```

### 从 GitHub 安装

```bash
pi install git:github.com/yourname/pi-skill-manage
```

### 从 npm 安装

```bash
pi install npm:@your-scope/pi-skill-manage
```

安装后执行：

```bash
/reload
```

然后可以先验证：

```bash
/skills-zh-status
/skills-zh
```

## 开发与本地测试

当前 extension 使用：

- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-ai`
- Node 内置模块：`fs`、`os`、`path`

建议本地验证流程：

```bash
pi install /Users/prince/github/extension/pi-skill-manage
/reload
/skills-zh-status
/skills-zh
```

如果要临时加载单文件进行测试：

```bash
pi -e /Users/prince/github/extension/pi-skill-manage/extensions/index.ts
```

## 发布前检查

- 确认 `/skills-zh`、`/skill-zh`、`/skills-zh-status` 正常可用
- 确认 `/skills-zh refresh` 能正常调用当前模型进行翻译
- 补一个截图或录屏，便于公开展示
- 如需发布到 npm，确定最终 package 名称与 scope（例如 `pi-skill-manage`）

## License

MIT
