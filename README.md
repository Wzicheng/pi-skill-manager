# pi-skills-zh

为 pi 的 skills 提供中文说明、分类浏览和基于当前模型的增量翻译缓存。

## 这是什么

这是一个 **pi extension**，不是 skill。

它会给 pi 增加几个命令，用来：

- 浏览当前已注册的 skills
- 按分类查看 skills
- 查看单个 skill 的中英文说明
- 使用当前选中的模型把英文 description 翻译成中文
- 把翻译结果缓存在本地，避免重复翻译
- 查看当前翻译进度与整体覆盖情况

## 当前命令

- `/skills-zh`：按分类查看 skills
- `/skills-zh refresh`：刷新全部翻译缓存
- `/skills-zh refresh <skill-name>`：刷新单个 skill
- `/skills-zh all`：按分类展开全部 skills
- `/skills-zh untranslated`：查看未翻译 skills
- `/skill-zh <skill-name>`：查看单个 skill 的中英文说明
- `/skills-zh-status`：查看当前任务状态和整体翻译覆盖率

## 功能

- 不修改原始 skill 文件
- 基于当前 pi 模型翻译，而不是依赖外部固定翻译接口
- 增量缓存：英文 description 不变时直接复用缓存
- 任务状态显示：支持状态栏和任务进度
- 防重复执行：翻译任务运行中会拦截重复触发
- 单次失败日志：仅保留最近一次翻译任务的失败项

## 本地文件

默认会写入：

- 缓存：`~/.pi/agent/skill-translations.json`
- 最近一次失败项：`~/.pi/agent/skill-translations-last-errors.json`

## 安装

### 从本地目录安装

```bash
pi install /absolute/path/to/pi-skills-zh
```

例如：

```bash
pi install /Users/prince/github/extension/pi-skills-zh
```

### 从 GitHub 安装

```bash
pi install git:github.com/yourname/pi-skills-zh
```

### 从 npm 安装

```bash
pi install npm:@your-scope/pi-skills-zh
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
pi install /Users/prince/github/extension/pi-skills-zh
/reload
/skills-zh-status
/skills-zh
```

如果要临时加载单文件进行测试：

```bash
pi -e /Users/prince/github/extension/pi-skills-zh/extensions/index.ts
```

## 发布前检查

- 确认 `/skills-zh`、`/skill-zh`、`/skills-zh-status` 正常可用
- 确认 `/skills-zh refresh` 能正常调用当前模型进行翻译
- 补一个截图或录屏，便于公开展示
- 如需发布到 npm，确定最终 package 名称与 scope

## License

MIT
