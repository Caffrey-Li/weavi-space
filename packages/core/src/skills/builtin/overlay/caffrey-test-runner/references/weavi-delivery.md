# 小围空间「需求交付」：领取用例、执行、回传结果

小围空间（Weavi Space）的需求交付可以选「在我的电脑执行（Claude Code）」。这时用例不在本地 YAML 里，而是通过小围空间的 MCP 服务领取，执行结果逐条回传。用户通常会这样说：

> 用 caffrey-test-runner 执行小围空间需求交付的测试，run id：cmx…，结果回传

## 准备（第一次）

1. 用户在小围空间「设置 · 个人能力」创建 API 令牌，勾选「读文档」「编辑文档」。
2. 在 Claude Code 里添加 MCP 服务：地址是 `<小围空间域名>/api/mcp`，请求头 `Authorization: Bearer <令牌>`。
3. 能看到 `delivery_list_test_runs` 等 4 个工具就说明连好了。连不上时让用户检查令牌是否过期、权限是否勾选。

## 4 个工具

| 工具 | 作用 |
| --- | --- |
| `delivery_list_test_runs` | 列出等着在本机执行的轮次（runId、第几轮、文档、环境地址、已回传几条） |
| `delivery_get_test_run` | 领取并读取一轮：`env.url`、测试账号（密码只给发起人）、每条用例的结构化步骤 `steps` 和预期 `expected`。第一次调用就算领取 |
| `delivery_report_test_result` | 回传一条：`runId`、`code`（如 TC-03）、`status`（passed / failed / blocked / skipped）、`message`（失败或阻塞的现象）、`failedStep`（第几步出错）、`durationMs`、`screenshotBase64`（PNG / JPEG，≤ 5 MB） |
| `delivery_finish_test_run` | 全部回传后结束这一轮；没回传的用例留给用户在面板里填 |

## 执行流程

1. 用户给了 run id 就直接用；没给时先调 `delivery_list_test_runs`，只有一轮就用它，多轮时列出来问用户。
2. 调 `delivery_get_test_run` 读用例，按本技能「执行流程」第 2 步做执行前确认：环境地址、执行哪些用例（默认全部）、用哪个端（Web / App / 小程序 / 桌面）。确认前不要回传任何结果。
3. 步骤是结构化的，含义和 `references/case-format.md` 的动作对应：

   | action | 含义 |
   | --- | --- |
   | goto | 打开 `env.url` + target（target 是以 / 开头的路径） |
   | click / fill / select | 操作 target 指的元素；target 写法：`label=标签`、`role=button[name=登录]`、`text=文字`、`placeholder=提示`、`testid=…`、`css=选择器` |
   | press | 按键（value） |
   | wait | 等待 value 秒 |
   | expectText / expectUrl / expectVisible | 断言出现文字 / 地址包含 / 元素可见 |
   | note | 人工步骤，按文字描述操作（App、小程序、扫码等） |

   `{{username}}` / `{{password}}` 换成 `account` 里的值。Web 用 `references/web.md` 的方式执行，App、小程序、桌面应用分别看对应文件。
4. **每条执行完立刻回传**，不要攒到最后：通过回传 passed；断言不符回传 failed，`message` 写清实际看到了什么、`failedStep` 写出错步骤，附截图；环境打不开、登录不上回传 blocked；不适用或没法执行的回传 skipped 并说明原因。
5. 全部回传后调 `delivery_finish_test_run`，把它返回的 `next` 原样转告用户：去面板点「完成本轮」，系统会自动提 Bug、写测试记录。**不要自己去建 Bug**，提 Bug 由小围空间统一去重。

## 铁律（在本技能铁律之外）

- 只访问 `env.url` 下的地址，不要去测其他业务网站。
- `message` 和截图说明里不写密码、令牌；系统会再打一次码，但不要依赖它。
- 拿不准的断言按本技能规则记为 failed 并写明原因，不要回传 passed。
