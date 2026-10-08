# qoder-bmw 接入包

`packages/harness-qoder` 是 BMW 的 Qoder CN 适配器，采用官方 SDK 的 Agent 循环。`qoder-bmw/SKILL.md` 是同包的复用操作指导，BMW 的 SDK 路径直接把它装配进 system prompt，保持 `skills: []`，避免新增技能工具或继承用户插件。指导文件不承担权限边界；真正的边界是输入前的有效工具目录检查和 BMW Bridge 的 Project/Session 租约。

## 当前运行路径

应用装配使用导出的 `QoderBackend`，传入独立的正常 CLI `configDirectory` 和 Host 提供的 `connection(request)`。连接包含 BMW 发放的短期 binding、认证 Bridge 地址和固定 MCP 入口。每轮启动官方 Worker，确认 init 只有已连接的 `browser` 后才释放输入；恢复沿用不可替换的 provider Session ID。完成或取消后等待 Worker 和 BMW 资源实际清理。

用户在 BMW Assistant 中发送消息、查看工具进度和结果、停止执行及续聊。Qoder 原生桌面侧边栏不作为这条 SDK 路径的交互前提，当前没有声明同步原生桌面历史。SDK 的配置与登录采用官方 CLI 流程，不读取桌面私有凭据。

默认装配将 Qoder 配置放在实际 BMW userData 的 `agent-drivers/qoder-cn`，不会初始化用户的默认 Qoder 桌面目录。Assistant 设置调用随应用安装的官方 CLI `login` 完成正常浏览器授权；CLI 1.1.64 没有已验证的非交互退出控制，因此 BMW 不显示可用退出操作。官方冷 SDK 控制会话读取账号状态和模型列表，输入流不产生消息，不持久化测试会话。GUI 首次切换到未读取的 Qoder CN 才加载认证，已读取结果复用 Profile 内的驱动缓存；手动刷新与实际运行前准入仍独立执行。缺少登录时显示登录框并保留改选驱动入口。登录后仅显示维护的 14 个 Worker 模型 ID 与官方启用目录的交集，名单见 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md)；点击“确认选择”即可。冷控制会话仍在内部检查初始化工具目录及原生模型成员，并在控制进程与事件读取实际结束后才保存偏好；没有用户验证按钮或模型推理输入。真实两轮模型验收目前覆盖 `auto`，不宣称所有 14 个型号均已逐一执行付费验收。

## 复用 skill

`packages/harness-qoder/qoder-bmw/SKILL.md` 可随适配器分发给已经连接 BMW `browser` 的 Agent。单独复制 skill 不会创建连接。BMW 不导出长期 Bridge token，也不把临时 Session binding 写进用户全局 MCP 配置。接入其他外部客户端时，需要由 BMW Host 发放并撤销明确的会话租约；原生客户端的额外工具不能靠 skill 文本关闭。

BMW、Project 媒体和 Studio 实现保持一份，`qoder-bmw` 不维护应用副本。三驱动默认入口和认证设置已启用，当前证据和能力限制见 [实施状态](AGENT_DRIVERS_IMPLEMENTATION.md)。
